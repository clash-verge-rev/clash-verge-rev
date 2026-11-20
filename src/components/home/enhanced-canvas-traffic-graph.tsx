import { Box, useTheme } from '@mui/material'
import type { Ref } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { useTrafficGraphDataEnhanced } from '@/hooks/use-traffic-monitor'
import { useVerge } from '@/hooks/use-verge'
import parseTraffic from '@/utils/parse-traffic'
import {
  formatTrafficHourMinute,
  formatTrafficMinuteSecond,
  formatTrafficName,
} from '@/utils/traffic-sampler'

export interface EnhancedCanvasTrafficGraphRef {
  toggleStyle: () => void
}

type TimeRange = 1 | 5 | 10

interface TooltipData {
  x: number
  y: number
  upSpeed: string
  downSpeed: string
  timestamp: string
  visible: boolean
  dataIndex: number
  highlightY: number
}

const MAX_POINTS = 300
const TARGET_FPS = 15
const LINE_WIDTH_UP = 2.5
const LINE_WIDTH_DOWN = 2.5
const LINE_WIDTH_GRID = 0.5
const ALPHA_GRADIENT = 0.15
const ALPHA_LINE = 0.9
const PADDING_TOP = 16
const PADDING_RIGHT = 16
const PADDING_BOTTOM = 32
const PADDING_LEFT = 35

const GRAPH_CONFIG = {
  maxPoints: MAX_POINTS,
  targetFPS: TARGET_FPS,
  lineWidth: {
    up: LINE_WIDTH_UP,
    down: LINE_WIDTH_DOWN,
    grid: LINE_WIDTH_GRID,
  },
  alpha: {
    gradient: ALPHA_GRADIENT,
    line: ALPHA_LINE,
  },
  padding: {
    top: PADDING_TOP,
    right: PADDING_RIGHT,
    bottom: PADDING_BOTTOM,
    left: PADDING_LEFT,
  },
}

const STALE_DATA_THRESHOLD = 2500 // ms without fresh data => drop FPS

// Static sx/style identities keep the emotion cache effective; the remaining
// dynamic props (tooltip position, legend colors) stay inline or memoized.
const rootSx = {
  width: '100%',
  height: '100%',
  position: 'relative',
  bgcolor: 'action.hover',
  borderRadius: 1,
  cursor: 'pointer',
  overflow: 'hidden',
}

const canvasStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
} as const

const hoverCanvasStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
  pointerEvents: 'none',
} as const

const overlaySx = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'none',
}

const timeRangeBadgeSx = {
  position: 'absolute',
  top: 6,
  left: 40,
  fontSize: '11px',
  fontWeight: 'bold',
  color: 'text.secondary',
  cursor: 'pointer',
  pointerEvents: 'all',
  px: 1,
  py: 0.5,
  borderRadius: 0.5,
  bgcolor: 'rgba(0,0,0,0.05)',
  '&:hover': {
    bgcolor: 'rgba(0,0,0,0.1)',
  },
}

const legendsSx = {
  position: 'absolute',
  top: 6,
  right: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.5,
}

const chartStyleHintSx = {
  position: 'absolute',
  bottom: 6,
  right: 8,
  fontSize: '10px',
  color: 'text.disabled',
  opacity: 0.7,
}

const diagnosticsSx = {
  position: 'absolute',
  bottom: 6,
  left: 8,
  fontSize: '9px',
  color: 'text.disabled',
  opacity: 0.6,
  lineHeight: 1.2,
}

const tooltipTimeSx = { color: 'text.secondary', mb: 0.2 }
const tooltipUpSx = { color: 'secondary.main', fontWeight: 500 }
const tooltipDownSx = { color: 'primary.main', fontWeight: 500 }

interface TimeDisplayStrategy {
  maxLabels: number
  formatTime: (timestamp: number) => string
  intervalSeconds: number
  minPixelDistance: number
}

const TIME_DISPLAY_STRATEGIES: Record<TimeRange, TimeDisplayStrategy> = {
  1: {
    maxLabels: 6,
    formatTime: formatTrafficMinuteSecond,
    intervalSeconds: 10,
    minPixelDistance: 35,
  },
  5: {
    maxLabels: 6,
    formatTime: formatTrafficHourMinute,
    intervalSeconds: 30,
    minPixelDistance: 38,
  },
  10: {
    maxLabels: 8,
    formatTime: formatTrafficHourMinute,
    intervalSeconds: 60,
    minPixelDistance: 40,
  },
}

// Per-draw buffers live at module scope: drawing runs synchronously on the
// main thread, so slots never overlap a concurrent reader.
const yAxisTicks = [
  { label: '', y: 0 },
  { label: '', y: 0 },
  { label: '', y: 0 },
]
const yAxisTickLabels = new Map<number, string>()
const formatYAxisTickLabel = (bytes: number): string => {
  const cached = yAxisTickLabels.get(bytes)
  if (cached !== undefined) return cached

  const label =
    bytes === 0
      ? '0'
      : bytes < 1024
        ? `${Math.round(bytes)}B`
        : bytes < 1024 * 1024
          ? `${Math.round(bytes / 1024)}KB`
          : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (yAxisTickLabels.size >= 256) yAxisTickLabels.clear()
  yAxisTickLabels.set(bytes, label)
  return label
}

const getYAxisTicks = (
  topValue: number,
  bottomValue: number,
  height: number,
) => {
  const padding = GRAPH_CONFIG.padding

  const topY = padding.top + 10
  const bottomY = height - padding.bottom - 5
  const middleY = (topY + bottomY) / 2
  const middleValue = (bottomValue + topValue) / 2

  const [bottomTick, middleTick, topTick] = yAxisTicks
  bottomTick.label = formatYAxisTickLabel(bottomValue)
  bottomTick.y = bottomY
  middleTick.label = formatYAxisTickLabel(middleValue)
  middleTick.y = middleY
  topTick.label = formatYAxisTickLabel(topValue)
  topTick.y = topY

  return yAxisTicks
}

interface TimeAxisPoint {
  x: number
  label: string
}
const timeAxisPoints: TimeAxisPoint[] = []
const resetTimeAxisPoints = () => {
  timeAxisPoints.length = 0
}
const pushTimeAxisPoint = (x: number, label: string) => {
  let slot = timeAxisPoints[timeAxisPoints.length]
  if (!slot) {
    slot = { x: 0, label: '' }
    timeAxisPoints.push(slot)
  }
  slot.x = x
  slot.label = label
}

// Gradient stop strings are pure functions of the theme color; the colors
// memo builds them once per theme.
const GRADIENT_ALPHA_HEX = Math.round(GRAPH_CONFIG.alpha.gradient * 255)
  .toString(16)
  .padStart(2, '0')
const makeGradientStops = (color: string) => ({
  start: `${color}${GRADIENT_ALPHA_HEX}`,
  end: `${color}00`,
})

interface EnhancedCanvasTrafficGraphProps {
  ref?: Ref<EnhancedCanvasTrafficGraphRef>
}

export const EnhancedCanvasTrafficGraph = memo(
  function EnhancedCanvasTrafficGraph({
    ref,
  }: EnhancedCanvasTrafficGraphProps) {
    const theme = useTheme()
    const { t } = useTranslation()
    const verge = useVerge()
    const pause_render_traffic_stats_on_blur =
      verge.verge?.pause_render_traffic_stats_on_blur ?? true

    const [timeRange, setTimeRange] = useState<TimeRange>(10)
    const [chartStyle, setChartStyle] = useState<'bezier' | 'line'>('bezier')
    const [badgeStats, setBadgeStats] = useState({ points: 0, compressed: 0 })

    const initialFocusState =
      typeof document !== 'undefined' ? !document.hidden : true
    const isDocumentVisibleRef = useRef(initialFocusState)

    const [tooltipData, setTooltipData] = useState<TooltipData>({
      x: 0,
      y: 0,
      upSpeed: '',
      downSpeed: '',
      timestamp: '',
      visible: false,
      dataIndex: -1,
      highlightY: 0,
    })
    const tooltipDataRef = useRef<TooltipData>(tooltipData)

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const hoverCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawFrameRef = useRef<number | undefined>(undefined)
    const hoverFrameRef = useRef<number | undefined>(undefined)
    const mouseMoveFrameRef = useRef<number | undefined>(undefined)
    const pendingMousePositionRef = useRef<{
      clientX: number
      clientY: number
    } | null>(null)
    const isWindowFocusedRef = useRef<boolean>(initialFocusState)
    const lastDataTimestampRef = useRef<number>(0)
    const dataStaleRef = useRef<boolean>(false)

    // Live snapshot data for the rAF draw path; React state only tracks the
    // diagnostics badge inputs so steady-state snapshots stop re-rendering.
    const displayDataRef = useRef<ITrafficDataPoint[]>([])
    const yScaleRef = useRef<{ topValue: number; bottomValue: number }>({
      topValue: 1024,
      bottomValue: 0,
    })

    const colors = useMemo(() => {
      const base = {
        up: theme.palette.secondary.main,
        down: theme.palette.primary.main,
        grid: theme.palette.divider,
        text: theme.palette.text.secondary,
        background: theme.palette.background.paper,
      }
      return {
        ...base,
        gradient: {
          up: makeGradientStops(base.up),
          down: makeGradientStops(base.down),
        },
      }
    }, [theme])

    const legendSx = useMemo(
      () => ({
        up: {
          fontSize: '11px',
          fontWeight: 'bold',
          color: colors.up,
          textAlign: 'right',
        },
        down: {
          fontSize: '11px',
          fontWeight: 'bold',
          color: colors.down,
          textAlign: 'right',
        },
      }),
      [colors],
    )

    const handleFocusStateChange = useEffectEvent((focused: boolean) => {
      isWindowFocusedRef.current = focused

      scheduleDrawGraph()
    })

    useEffect(() => {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return
      }

      const handleFocus = () => handleFocusStateChange(true)
      const handleBlur = () => handleFocusStateChange(false)
      const handleVisibilityChange = () => {
        const visible = !document.hidden
        isDocumentVisibleRef.current = visible
        handleFocusStateChange(visible)
      }

      window.addEventListener('focus', handleFocus)
      window.addEventListener('blur', handleBlur)
      document.addEventListener('visibilitychange', handleVisibilityChange)

      return () => {
        window.removeEventListener('focus', handleFocus)
        window.removeEventListener('blur', handleBlur)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }, [])

    const calculateY = useCallback(
      (
        value: number,
        height: number,
        topValue: number,
        bottomValue: number,
      ): number => {
        const padding = GRAPH_CONFIG.padding
        const topY = padding.top + 10
        const bottomY = height - padding.bottom - 5

        if (topValue === bottomValue) return bottomY

        const ratio = (value - bottomValue) / (topValue - bottomValue)
        return bottomY - ratio * (bottomY - topY)
      },
      [],
    )

    const computeYScale = useCallback(
      (
        data: ITrafficDataPoint[],
      ): { topValue: number; bottomValue: number } => {
        if (data.length === 0) return { topValue: 1024, bottomValue: 0 }

        let maxValue = 0
        let minValue = Infinity
        for (let i = 0; i < data.length; i++) {
          const up = data[i].up
          const down = data[i].down
          if (up > maxValue) maxValue = up
          if (down > maxValue) maxValue = down
          if (up < minValue) minValue = up
          if (down < minValue) minValue = down
        }
        if (!isFinite(minValue)) minValue = 0

        if (maxValue === 0) return { topValue: 1024, bottomValue: 0 }

        const range = maxValue - minValue
        if (range === 0) return { topValue: maxValue * 1.2, bottomValue: 0 }

        const pct = 0.1
        return {
          topValue: maxValue + range * pct,
          bottomValue: Math.max(0, minValue - range * pct),
        }
      },
      [],
    )

    const handleMouseMove = useCallback(
      (event: React.MouseEvent<HTMLElement>) => {
        if (displayDataRef.current.length === 0) return

        pendingMousePositionRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
        }

        if (mouseMoveFrameRef.current !== undefined) return

        mouseMoveFrameRef.current = requestAnimationFrame(() => {
          mouseMoveFrameRef.current = undefined

          const pendingMousePosition = pendingMousePositionRef.current
          pendingMousePositionRef.current = null
          if (!pendingMousePosition) return

          const canvas = canvasRef.current
          const data = displayDataRef.current
          if (!canvas || data.length === 0) return

          const rect = canvas.getBoundingClientRect()
          const mouseX = pendingMousePosition.clientX - rect.left
          const mouseY = pendingMousePosition.clientY - rect.top

          const padding = GRAPH_CONFIG.padding
          const effectiveWidth = rect.width - padding.left - padding.right
          if (effectiveWidth <= 0) return

          const relativeMouseX = mouseX - padding.left
          const ratio = Math.max(
            0,
            Math.min(1, relativeMouseX / effectiveWidth),
          )
          const dataIndex = Math.round(ratio * (data.length - 1))

          if (dataIndex < 0 || dataIndex >= data.length) return

          const dataPoint = data[dataIndex]

          const [upValue, upUnit] = parseTraffic(dataPoint.up)
          const [downValue, downUnit] = parseTraffic(dataPoint.down)

          const timeStr = dataPoint.timestamp
            ? formatTrafficName(dataPoint.timestamp)
            : t('home.components.traffic.unknownTime')

          const { topValue: tvH, bottomValue: bvH } = yScaleRef.current
          const upY = calculateY(dataPoint.up, rect.height, tvH, bvH)
          const downY = calculateY(dataPoint.down, rect.height, tvH, bvH)
          const highlightY =
            Math.max(dataPoint.up, dataPoint.down) === dataPoint.up
              ? upY
              : downY

          const nextTooltipData = {
            x: mouseX,
            y: mouseY,
            upSpeed: `${upValue}${upUnit}/s`,
            downSpeed: `${downValue}${downUnit}/s`,
            timestamp: timeStr,
            visible: true,
            dataIndex,
            highlightY,
          }

          setTooltipData((prev) => {
            if (
              prev.visible &&
              prev.dataIndex === nextTooltipData.dataIndex &&
              Math.abs(prev.x - nextTooltipData.x) < 1 &&
              Math.abs(prev.y - nextTooltipData.y) < 1 &&
              Math.abs(prev.highlightY - nextTooltipData.highlightY) < 1 &&
              prev.upSpeed === nextTooltipData.upSpeed &&
              prev.downSpeed === nextTooltipData.downSpeed &&
              prev.timestamp === nextTooltipData.timestamp
            ) {
              return prev
            }

            return nextTooltipData
          })
        })
      },
      [calculateY, t],
    )

    const handleMouseLeave = useCallback(() => {
      pendingMousePositionRef.current = null

      if (mouseMoveFrameRef.current !== undefined) {
        cancelAnimationFrame(mouseMoveFrameRef.current)
        mouseMoveFrameRef.current = undefined
      }

      setTooltipData((prev) =>
        prev.visible ? { ...prev, visible: false } : prev,
      )
    }, [])

    const drawYAxis = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        topValue: number,
        bottomValue: number,
      ) => {
        const padding = GRAPH_CONFIG.padding
        const ticks = getYAxisTicks(topValue, bottomValue, height)

        ctx.save()

        ticks.forEach((tick, index) => {
          const isBottomTick = index === 0
          const isTopTick = index === ticks.length - 1

          if (isBottomTick || isTopTick) {
            ctx.strokeStyle = colors.grid
            ctx.lineWidth = isBottomTick ? 0.8 : 0.4
            ctx.globalAlpha = isBottomTick ? 0.25 : 0.15

            ctx.beginPath()
            ctx.moveTo(padding.left, tick.y)
            ctx.lineTo(width - padding.right, tick.y)
            ctx.stroke()
          }

          ctx.fillStyle = colors.text
          ctx.font =
            "8px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
          ctx.globalAlpha = 0.9
          ctx.textAlign = 'right'
          ctx.textBaseline = 'middle'

          if (tick.label !== '0') {
            const labelWidth = ctx.measureText(tick.label).width
            ctx.globalAlpha = 0.15
            ctx.fillStyle = colors.background
            ctx.fillRect(
              padding.left - labelWidth - 8,
              tick.y - 5,
              labelWidth + 4,
              10,
            )
          }

          ctx.globalAlpha = 0.9
          ctx.fillStyle = colors.text
          ctx.fillText(tick.label, padding.left - 4, tick.y)
        })

        ctx.restore()
      },
      [colors.grid, colors.text, colors.background],
    )

    const drawTimeAxis = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        data: ITrafficDataPoint[],
      ) => {
        if (data.length === 0) return

        const padding = GRAPH_CONFIG.padding
        const effectiveWidth = width - padding.left - padding.right
        const timeAxisY = height - padding.bottom + 14

        const strategy = TIME_DISPLAY_STRATEGIES[timeRange]

        ctx.save()
        ctx.fillStyle = colors.text
        ctx.font =
          "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
        ctx.globalAlpha = 0.7

        const targetLabels = Math.min(strategy.maxLabels, data.length)
        const step = Math.max(1, Math.floor(data.length / (targetLabels - 1)))

        const minPixelDistance = strategy.minPixelDistance || 45
        const actualStep = Math.max(
          step,
          Math.ceil((data.length * minPixelDistance) / effectiveWidth),
        )

        resetTimeAxisPoints()

        if (data.length > 0 && data[0].timestamp) {
          pushTimeAxisPoint(
            padding.left,
            strategy.formatTime(data[0].timestamp),
          )
        }

        for (
          let i = actualStep;
          i < data.length - actualStep;
          i += actualStep
        ) {
          const point = data[i]
          if (!point.timestamp) continue

          const x = padding.left + (i / (data.length - 1)) * effectiveWidth
          pushTimeAxisPoint(x, strategy.formatTime(point.timestamp))
        }

        if (data.length > 1 && data[data.length - 1].timestamp) {
          const lastX = width - padding.right
          const lastPoint = timeAxisPoints[timeAxisPoints.length - 1]

          if (!lastPoint || lastX - lastPoint.x >= minPixelDistance) {
            pushTimeAxisPoint(
              lastX,
              strategy.formatTime(data[data.length - 1].timestamp),
            )
          }
        }

        for (let i = 0; i < timeAxisPoints.length; i++) {
          const point = timeAxisPoints[i]
          if (i === 0) {
            ctx.textAlign = 'left'
          } else if (i === timeAxisPoints.length - 1) {
            ctx.textAlign = 'right'
          } else {
            ctx.textAlign = 'center'
          }

          ctx.fillText(point.label, point.x, timeAxisY)
        }

        ctx.restore()
      },
      [colors.text, timeRange],
    )

    const drawGrid = useCallback(
      (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        const padding = GRAPH_CONFIG.padding
        const effectiveWidth = width - padding.left - padding.right
        const effectiveHeight = height - padding.top - padding.bottom

        ctx.save()
        ctx.strokeStyle = colors.grid
        ctx.lineWidth = GRAPH_CONFIG.lineWidth.grid
        ctx.globalAlpha = 0.7

        const horizontalLines = 4
        for (let i = 1; i <= horizontalLines; i++) {
          const y = padding.top + (effectiveHeight / (horizontalLines + 1)) * i
          ctx.beginPath()
          ctx.moveTo(padding.left, y)
          ctx.lineTo(width - padding.right, y)
          ctx.stroke()
        }

        const verticalLines = 6
        for (let i = 1; i <= verticalLines; i++) {
          const x = padding.left + (effectiveWidth / (verticalLines + 1)) * i
          ctx.beginPath()
          ctx.moveTo(x, padding.top)
          ctx.lineTo(x, height - padding.bottom)
          ctx.stroke()
        }

        ctx.restore()
      },
      [colors.grid],
    )

    const drawTrafficLine = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        data: ITrafficDataPoint[],
        valueKey: 'up' | 'down',
        width: number,
        height: number,
        color: string,
        gradientStops: { start: string; end: string },
        withGradient = false,
        topValue: number,
        bottomValue: number,
      ) => {
        if (data.length < 2) return

        const padding = GRAPH_CONFIG.padding
        const effectiveWidth = width - padding.left - padding.right
        const lastIndex = data.length - 1
        const getX = (index: number) =>
          padding.left + (index / lastIndex) * effectiveWidth
        const getY = (index: number) =>
          calculateY(data[index][valueKey], height, topValue, bottomValue)

        ctx.save()

        if (withGradient && chartStyle === 'bezier') {
          const gradient = ctx.createLinearGradient(
            0,
            padding.top,
            0,
            height - padding.bottom,
          )
          gradient.addColorStop(0, gradientStops.start)
          gradient.addColorStop(1, gradientStops.end)

          ctx.beginPath()
          ctx.moveTo(getX(0), getY(0))

          for (let i = 1; i < data.length; i++) {
            const currentX = getX(i)
            const currentY = getY(i)
            const nextIndex = Math.min(i + 1, lastIndex)
            const controlX = (currentX + getX(nextIndex)) / 2
            const controlY = (currentY + getY(nextIndex)) / 2
            ctx.quadraticCurveTo(currentX, currentY, controlX, controlY)
          }

          ctx.lineTo(getX(lastIndex), height - padding.bottom)
          ctx.lineTo(getX(0), height - padding.bottom)
          ctx.closePath()
          ctx.fillStyle = gradient
          ctx.fill()
        }

        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = GRAPH_CONFIG.lineWidth.up
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = GRAPH_CONFIG.alpha.line

        ctx.moveTo(getX(0), getY(0))

        if (chartStyle === 'bezier') {
          for (let i = 1; i < data.length; i++) {
            const currentX = getX(i)
            const currentY = getY(i)
            const nextIndex = Math.min(i + 1, lastIndex)
            const controlX = (currentX + getX(nextIndex)) / 2
            const controlY = (currentY + getY(nextIndex)) / 2
            ctx.quadraticCurveTo(currentX, currentY, controlX, controlY)
          }
        } else {
          for (let i = 1; i < data.length; i++) {
            ctx.lineTo(getX(i), getY(i))
          }
        }

        ctx.stroke()
        ctx.restore()
      },
      [calculateY, chartStyle],
    )

    const syncCanvasSize = useCallback((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const cssWidth = rect.width
      const cssHeight = rect.height
      const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr))
      const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr))

      if (canvas.style.width !== '100%') {
        canvas.style.width = '100%'
      }
      if (canvas.style.height !== '100%') {
        canvas.style.height = '100%'
      }

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
      }

      return { ctx, cssWidth, cssHeight }
    }, [])

    const clearCanvas = useCallback(
      (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return
        const synced = syncCanvasSize(canvas)
        if (!synced) return
        synced.ctx.clearRect(0, 0, synced.cssWidth, synced.cssHeight)
      },
      [syncCanvasSize],
    )

    const drawGraph = useCallback(() => {
      const canvas = canvasRef.current
      const displayData = displayDataRef.current
      if (!canvas || displayData.length === 0) {
        clearCanvas(canvasRef.current)
        clearCanvas(hoverCanvasRef.current)
        return
      }

      const synced = syncCanvasSize(canvas)
      if (!synced) return
      const { ctx, cssWidth, cssHeight } = synced

      // Clear using CSS dimensions; context is already scaled by DPR.
      ctx.clearRect(0, 0, cssWidth, cssHeight)

      const { topValue, bottomValue } = yScaleRef.current

      drawYAxis(ctx, cssWidth, cssHeight, topValue, bottomValue)

      drawGrid(ctx, cssWidth, cssHeight)

      drawTimeAxis(ctx, cssWidth, cssHeight, displayData)

      drawTrafficLine(
        ctx,
        displayData,
        'down',
        cssWidth,
        cssHeight,
        colors.down,
        colors.gradient.down,
        true,
        topValue,
        bottomValue,
      )

      drawTrafficLine(
        ctx,
        displayData,
        'up',
        cssWidth,
        cssHeight,
        colors.up,
        colors.gradient.up,
        true,
        topValue,
        bottomValue,
      )

      clearCanvas(hoverCanvasRef.current)
      if (
        import.meta.env.MODE === 'perf' &&
        canvas.dataset.perfDraw !== String(displayData.at(-1)?.timestamp ?? 0)
      )
        canvas.dataset.perfDraw = String(displayData.at(-1)?.timestamp ?? 0)
    }, [
      colors,
      drawYAxis,
      drawGrid,
      drawTimeAxis,
      drawTrafficLine,
      syncCanvasSize,
      clearCanvas,
    ])

    const drawHoverOverlay = useCallback(() => {
      const canvas = hoverCanvasRef.current
      const displayData = displayDataRef.current
      if (!canvas || displayData.length < 2) {
        clearCanvas(canvas)
        return
      }

      const synced = syncCanvasSize(canvas)
      if (!synced) return
      const { ctx, cssWidth, cssHeight } = synced

      ctx.clearRect(0, 0, cssWidth, cssHeight)

      const currentTooltip = tooltipDataRef.current
      if (currentTooltip.visible && currentTooltip.dataIndex >= 0) {
        const padding = GRAPH_CONFIG.padding
        const effectiveWidth = cssWidth - padding.left - padding.right
        const dataX =
          padding.left +
          (currentTooltip.dataIndex / (displayData.length - 1)) * effectiveWidth

        ctx.save()
        ctx.strokeStyle = colors.text
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.6
        ctx.setLineDash([4, 4])

        ctx.beginPath()
        ctx.moveTo(dataX, padding.top)
        ctx.lineTo(dataX, cssHeight - padding.bottom)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(padding.left, currentTooltip.highlightY)
        ctx.lineTo(cssWidth - padding.right, currentTooltip.highlightY)
        ctx.stroke()

        ctx.restore()
      }
    }, [colors, syncCanvasSize, clearCanvas])

    const shouldSkipGraphDraw = useCallback(() => {
      if (!isDocumentVisibleRef.current) return true

      if (!isWindowFocusedRef.current && pause_render_traffic_stats_on_blur) {
        return true
      }

      const lastDataTimestamp = lastDataTimestampRef.current
      if (
        lastDataTimestamp > 0 &&
        Date.now() - lastDataTimestamp > STALE_DATA_THRESHOLD
      ) {
        dataStaleRef.current = true
        return true
      }

      return dataStaleRef.current
    }, [pause_render_traffic_stats_on_blur])

    const scheduleHoverDraw = useCallback(() => {
      if (hoverFrameRef.current !== undefined) return

      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = undefined
        drawHoverOverlay()
      })
    }, [drawHoverOverlay])

    const scheduleDrawGraph = useCallback(() => {
      if (drawFrameRef.current !== undefined) return

      drawFrameRef.current = requestAnimationFrame(() => {
        drawFrameRef.current = undefined

        if (shouldSkipGraphDraw()) return

        drawGraph()
        drawHoverOverlay()
      })
    }, [drawGraph, drawHoverOverlay, shouldSkipGraphDraw])

    const handleSnapshot = useCallback(
      (message: ITrafficWorkerSnapshotMessage) => {
        const data = message.dataPoints
        displayDataRef.current = data
        yScaleRef.current = computeYScale(data)

        if (data.length === 0) {
          lastDataTimestampRef.current = 0
          dataStaleRef.current = false
        } else {
          const latestTimestamp = data[data.length - 1]?.timestamp ?? null
          if (latestTimestamp) {
            lastDataTimestampRef.current = latestTimestamp
            const age = Date.now() - latestTimestamp
            const stale = age > STALE_DATA_THRESHOLD
            dataStaleRef.current = stale
          } else {
            dataStaleRef.current = false
          }
        }

        scheduleDrawGraph()
        // The badge is the only snapshot content that still renders; keeping
        // its state here confines re-renders to actual badge changes, and the
        // visibility gate skips hidden-phase renders — the re-prime snapshot
        // on regaining visibility refreshes it.
        if (!isDocumentVisibleRef.current) return
        setBadgeStats((prev) =>
          prev.points === data.length &&
          prev.compressed === message.samplerStats.compressedBufferSize
            ? prev
            : {
                points: data.length,
                compressed: message.samplerStats.compressedBufferSize,
              },
        )
      },
      [computeYScale, scheduleDrawGraph],
    )

    const { requestRange } = useTrafficGraphDataEnhanced({
      subscribe: false,
      onSnapshot: handleSnapshot,
    })

    useEffect(() => {
      requestRange(timeRange)
    }, [requestRange, timeRange])

    useEffect(() => {
      tooltipDataRef.current = tooltipData
      scheduleHoverDraw()
    }, [tooltipData, scheduleHoverDraw])

    useEffect(() => {
      scheduleDrawGraph()
    }, [scheduleDrawGraph])

    const redrawGraph = useEffectEvent(() => scheduleDrawGraph())

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || typeof window === 'undefined') return

      if (typeof ResizeObserver === 'undefined') {
        const handleResize = () => redrawGraph()
        window.addEventListener('resize', handleResize)
        return () => {
          window.removeEventListener('resize', handleResize)
        }
      }

      const resizeObserver = new ResizeObserver(() => redrawGraph())
      resizeObserver.observe(canvas)

      return () => {
        resizeObserver.disconnect()
      }
    }, [])

    useEffect(() => {
      return () => {
        if (drawFrameRef.current !== undefined) {
          cancelAnimationFrame(drawFrameRef.current)
          drawFrameRef.current = undefined
        }
        if (hoverFrameRef.current !== undefined) {
          cancelAnimationFrame(hoverFrameRef.current)
          hoverFrameRef.current = undefined
        }
        if (mouseMoveFrameRef.current !== undefined) {
          cancelAnimationFrame(mouseMoveFrameRef.current)
          mouseMoveFrameRef.current = undefined
        }
      }
    }, [])

    const handleTimeRangeClick = useCallback((event: React.MouseEvent) => {
      event.stopPropagation()
      setTimeRange((prev) => {
        return prev === 1 ? 5 : prev === 5 ? 10 : 1
      })
    }, [])

    const toggleStyle = useCallback(() => {
      setChartStyle((prev) => (prev === 'bezier' ? 'line' : 'bezier'))
    }, [])

    useImperativeHandle(ref, () => ({ toggleStyle }), [toggleStyle])

    const getTimeRangeText = useCallback(() => {
      return t('home.components.traffic.patterns.minutes', {
        time: timeRange,
      })
    }, [timeRange, t])

    return (
      <Box
        sx={rootSx}
        onClick={toggleStyle}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <canvas ref={canvasRef} style={canvasStyle} onClick={toggleStyle} />

        {tooltipData.visible && (
          <canvas ref={hoverCanvasRef} style={hoverCanvasStyle} />
        )}

        <Box sx={overlaySx}>
          <Box
            component="div"
            onClick={handleTimeRangeClick}
            sx={timeRangeBadgeSx}
          >
            {getTimeRangeText()}
          </Box>

          <Box sx={legendsSx}>
            <Box sx={legendSx.up}>
              {t('home.components.traffic.legends.upload')}
            </Box>
            <Box sx={legendSx.down}>
              {t('home.components.traffic.legends.download')}
            </Box>
          </Box>

          <Box sx={chartStyleHintSx}>
            {t(
              chartStyle === 'bezier'
                ? 'home.components.traffic.chartStyles.smooth'
                : 'home.components.traffic.chartStyles.linear',
            )}
          </Box>

          <Box sx={diagnosticsSx}>
            {t('home.components.traffic.diagnostics', {
              points: badgeStats.points,
              compressed: badgeStats.compressed,
              fps: GRAPH_CONFIG.targetFPS,
            })}
          </Box>

          {tooltipData.visible && (
            <Box
              style={{ left: tooltipData.x + 8, top: tooltipData.y - 8 }}
              sx={{
                position: 'absolute',
                bgcolor: theme.palette.background.paper,
                border: 1,
                borderColor: 'divider',
                borderRadius: 0.5,
                px: 1,
                py: 0.5,
                fontSize: '10px',
                lineHeight: 1.2,
                zIndex: 1000,
                pointerEvents: 'none',
                transform:
                  tooltipData.x > 200 ? 'translateX(-100%)' : 'translateX(0)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                backdropFilter: 'none',
                opacity: 1,
                whiteSpace: 'nowrap',
              }}
            >
              <Box sx={tooltipTimeSx}>{tooltipData.timestamp}</Box>
              <Box sx={tooltipUpSx}>↑ {tooltipData.upSpeed}</Box>
              <Box sx={tooltipDownSx}>↓ {tooltipData.downSpeed}</Box>
            </Box>
          )}
        </Box>
      </Box>
    )
  },
)

EnhancedCanvasTrafficGraph.displayName = 'EnhancedCanvasTrafficGraph'
