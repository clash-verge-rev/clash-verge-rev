import { useTheme } from '@mui/material'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Traffic } from 'tauri-plugin-mihomo-api'

const maxPoint = 30

const refLineAlpha = 1
const refLineWidth = 2

const upLineAlpha = 0.6
const upLineWidth = 4

const downLineAlpha = 1
const downLineWidth = 4
const frameIntervalMs = 1000 / 15

const defaultList = Array(maxPoint + 2).fill({ up: 0, down: 0 })

export interface TrafficRef {
  appendData: (data: Traffic) => void
  toggleStyle: () => void
}

type TrafficValueKey = 'up' | 'down'

/**
 * draw the traffic graph
 */
export function TrafficGraph({ ref }: { ref?: Ref<TrafficRef> }) {
  const countRef = useRef(0)
  const styleRef = useRef(true)
  const listRef = useRef<Traffic[]>(defaultList)
  const canvasRef = useRef<HTMLCanvasElement>(null!)

  const cacheRef = useRef<Traffic | null>(null)

  const { palette } = useTheme()

  useImperativeHandle(ref, () => ({
    appendData: (data: Traffic) => {
      cacheRef.current = data
    },
    toggleStyle: () => {
      styleRef.current = !styleRef.current
    },
  }))

  useEffect(() => {
    let timer: any
    const zero = { up: 0, down: 0 }

    const handleData = () => {
      const data = cacheRef.current ? cacheRef.current : zero
      cacheRef.current = null

      const list = listRef.current
      if (list.length > maxPoint + 2) list.shift()
      list.push(data)
      countRef.current = 0

      timer = setTimeout(handleData, 1000)
    }

    handleData()

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let frameTimer: ReturnType<typeof setTimeout> | null = null
    const canvas = canvasRef.current!

    if (!canvas) return

    const context = canvas.getContext('2d')!

    if (!context) return

    const { primary, secondary, divider } = palette
    const refLineColor = divider || 'rgba(0, 0, 0, 0.12)'
    const upLineColor = secondary.main || '#9c27b0'
    const downLineColor = primary.main || '#5b5c9d'

    const width = canvas.width
    const height = canvas.height
    const dx = width / maxPoint
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

    const drawBezier = (
      list: Traffic[],
      valueKey: TrafficValueKey,
      offset: number,
    ) => {
      if (list.length === 0) return

      const firstX = (dx * -1 - offset + 3) | 0
      const firstY = countY(list[0]?.[valueKey] ?? 0)

      context.moveTo(firstX, firstY)

      for (let i = 1; i < list.length; i++) {
        const p1x = (dx * (i - 1) - offset + 3) | 0
        const p1y = countY(list[i]?.[valueKey] ?? 0)

        const hasNext = i + 1 < list.length
        const p2x = hasNext ? (dx * i - offset + 3) | 0 : p1x
        const p2y = hasNext ? countY(list[i + 1]?.[valueKey] ?? 0) : p1y

        context.quadraticCurveTo(p1x, p1y, (p1x + p2x) / 2, (p1y + p2y) / 2)
      }
    }

    const drawLine = (
      list: Traffic[],
      valueKey: TrafficValueKey,
      offset: number,
    ) => {
      if (list.length === 0) return

      context.moveTo((dx * -1 - offset) | 0, countY(list[0]?.[valueKey] ?? 0))

      for (let i = 1; i < list.length; i++) {
        context.lineTo(
          (dx * (i - 1) - offset) | 0,
          countY(list[i]?.[valueKey] ?? 0),
        )
      }
    }

    const scheduleDraw = (lastTime: number, delay = 0) => {
      if (frameTimer !== null) {
        clearTimeout(frameTimer)
        frameTimer = null
      }

      if (delay > 0) {
        frameTimer = setTimeout(() => {
          frameTimer = null
          raf = requestAnimationFrame(() => {
            raf = 0
            drawGraph(lastTime)
          })
        }, delay)
        return
      }

      raf = requestAnimationFrame(() => {
        raf = 0
        drawGraph(lastTime)
      })
    }

    const drawGraph = (lastTime: number) => {
      const list = listRef.current
      const lineStyle = styleRef.current

      const now = Date.now()
      const diff = now - lastTime
      if (diff < frameIntervalMs) {
        scheduleDraw(lastTime, frameIntervalMs - diff)
        return
      }
      const temp = Math.min((diff / 1000) * dx + countRef.current, dx)
      const offset = countRef.current === 0 ? 0 : temp
      countRef.current = temp

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
        drawBezier(list, 'up', offset)
      } else {
        drawLine(list, 'up', offset)
      }
      context.stroke()
      context.closePath()

      context.beginPath()
      context.globalAlpha = downLineAlpha
      context.lineWidth = downLineWidth
      context.strokeStyle = downLineColor
      if (lineStyle) {
        drawBezier(list, 'down', offset)
      } else {
        drawLine(list, 'down', offset)
      }
      context.stroke()
      context.closePath()

      scheduleDraw(now, frameIntervalMs)
    }

    drawGraph(Date.now() - frameIntervalMs)

    return () => {
      if (frameTimer !== null) {
        clearTimeout(frameTimer)
      }
      if (raf) {
        cancelAnimationFrame(raf)
      }
    }
  }, [palette])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
