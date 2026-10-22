import { useTheme } from '@mui/material'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { Traffic } from 'tauri-plugin-mihomo-api'

const maxPoint = 30

const refLineAlpha = 1
const refLineWidth = 2

const upLineAlpha = 0.6
const upLineWidth = 4

const downLineAlpha = 1
const downLineWidth = 4
const sampleIntervalMs = 1000
const animationDurationMs = sampleIntervalMs

const zeroTraffic: Traffic = { up: 0, down: 0, upTotal: 0, downTotal: 0 }
const createDefaultList = () =>
  Array.from({ length: maxPoint + 2 }, () => ({ ...zeroTraffic }))

const hasTraffic = (traffic?: Traffic | null) =>
  (traffic?.up ?? 0) !== 0 || (traffic?.down ?? 0) !== 0

const hasRetainedTraffic = (list: Traffic[]) => list.some(hasTraffic)

export interface TrafficRef {
  appendData: (data: Traffic) => void
  toggleStyle: () => void
}

type TrafficValueKey = 'up' | 'down'

/**
 * draw the traffic graph
 */
export function TrafficGraph({ ref }: { ref?: Ref<TrafficRef> }) {
  const animationStartRef = useRef<number | null>(null)
  const styleRef = useRef(true)
  const listRef = useRef<Traffic[]>(createDefaultList())
  const canvasRef = useRef<HTMLCanvasElement>(null!)

  const cacheRef = useRef<Traffic | null>(null)
  const requestDrawRef = useRef<(animate?: boolean) => void>(() => {})

  const { palette } = useTheme()

  useImperativeHandle(ref, () => ({
    appendData: (data: Traffic) => {
      cacheRef.current = data
    },
    toggleStyle: () => {
      styleRef.current = !styleRef.current
      requestDrawRef.current(false)
    },
  }))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const handleData = () => {
      const data = cacheRef.current ?? zeroTraffic
      cacheRef.current = null

      const list = listRef.current
      const shouldAppend = hasTraffic(data) || hasRetainedTraffic(list)

      if (shouldAppend) {
        if (list.length > maxPoint + 2) list.shift()
        list.push(data)
        requestDrawRef.current(true)
      }

      timer = setTimeout(handleData, sampleIntervalMs)
    }

    handleData()

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let animation: Animation | null = null
    let resizeObserver: ResizeObserver | null = null
    const canvas = canvasRef.current!

    if (!canvas) return

    const context = canvas.getContext('2d')!

    if (!context) return

    const { primary, secondary, divider } = palette
    const refLineColor = divider || 'rgba(0, 0, 0, 0.12)'
    const upLineColor = secondary.main || '#9c27b0'
    const downLineColor = primary.main || '#5b5c9d'

    const drawGraph = () => {
      const list = listRef.current
      const lineStyle = styleRef.current

      const width = canvas.width
      const height = canvas.height
      const dx = width / (maxPoint + 1)
      const dy = height / 7
      const l1 = dy
      const l2 = dy * 4

      const countY = (v: number) => {
        const h = height

        if (v == 0) return h - 1
        if (v <= 10) return h - (v / 10) * dy
        if (v <= 100) return h - (v / 100 + 1) * dy
        if (v <= 1024) return h - (v / 1024 + 2) * dy
        if (v <= 10240) return h - (v / 10240 + 3) * dy
        if (v <= 102400) return h - (v / 102400 + 4) * dy
        if (v <= 1048576) return h - (v / 1048576 + 5) * dy
        if (v <= 10485760) return h - (v / 10485760 + 6) * dy
        return 1
      }

      const drawBezier = (list: Traffic[], valueKey: TrafficValueKey) => {
        if (list.length === 0) return

        const firstX = (dx * -1 + 3) | 0
        const firstY = countY(list[0]?.[valueKey] ?? 0)

        context.moveTo(firstX, firstY)

        for (let i = 1; i < list.length; i++) {
          const p1x = (dx * (i - 1) + 3) | 0
          const p1y = countY(list[i]?.[valueKey] ?? 0)

          const hasNext = i + 1 < list.length
          const p2x = hasNext ? (dx * i + 3) | 0 : p1x
          const p2y = hasNext ? countY(list[i + 1]?.[valueKey] ?? 0) : p1y

          context.quadraticCurveTo(p1x, p1y, (p1x + p2x) / 2, (p1y + p2y) / 2)
        }
      }

      const drawLine = (list: Traffic[], valueKey: TrafficValueKey) => {
        if (list.length === 0) return

        context.moveTo((dx * -1) | 0, countY(list[0]?.[valueKey] ?? 0))

        for (let i = 1; i < list.length; i++) {
          context.lineTo((dx * (i - 1)) | 0, countY(list[i]?.[valueKey] ?? 0))
        }
      }

      context.clearRect(0, 0, width, height)

      // Reference lines
      context.beginPath()
      context.globalAlpha = refLineAlpha
      context.lineWidth = refLineWidth
      context.strokeStyle = refLineColor
      context.moveTo(0, l1)
      context.lineTo(width, l1)
      context.moveTo(0, l2)
      context.lineTo(width, l2)
      context.stroke()
      context.closePath()

      context.beginPath()
      context.globalAlpha = upLineAlpha
      context.lineWidth = upLineWidth
      context.strokeStyle = upLineColor
      if (lineStyle) {
        drawBezier(list, 'up')
      } else {
        drawLine(list, 'up')
      }
      context.stroke()
      context.closePath()

      context.beginPath()
      context.globalAlpha = downLineAlpha
      context.lineWidth = downLineWidth
      context.strokeStyle = downLineColor
      if (lineStyle) {
        drawBezier(list, 'down')
      } else {
        drawLine(list, 'down')
      }
      context.stroke()
      context.closePath()
    }

    const requestDraw = (animate = false) => {
      if (animate) animationStartRef.current = performance.now()
      animation?.cancel()
      drawGraph()

      const elapsed =
        animationStartRef.current === null
          ? 0
          : Math.min(
              performance.now() - animationStartRef.current,
              animationDurationMs,
            )
      const step = canvas.getBoundingClientRect().width / (maxPoint + 1)
      animation = canvas.animate(
        [
          { transform: 'translateX(0)' },
          { transform: `translateX(${-step}px)` },
        ],
        { duration: animationDurationMs, easing: 'linear', fill: 'forwards' },
      )
      animation.currentTime = elapsed
      if (animationStartRef.current === null) animation.pause()
    }

    requestDrawRef.current = requestDraw
    requestDraw(false)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => requestDraw(false))
      resizeObserver.observe(canvas.parentElement!)
    }

    return () => {
      if (requestDrawRef.current === requestDraw) {
        requestDrawRef.current = () => {}
      }
      resizeObserver?.disconnect()
      animation?.cancel()
    }
  }, [palette])

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        width={310}
        style={{
          width: `${((maxPoint + 1) / maxPoint) * 100}%`,
          height: '100%',
        }}
      />
    </div>
  )
}
