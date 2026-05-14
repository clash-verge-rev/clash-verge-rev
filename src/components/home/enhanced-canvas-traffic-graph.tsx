import { Box, useTheme } from '@mui/material'
import type { Ref } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { useTrafficGraphDataEnhanced } from '@/hooks/use-traffic-monitor'
import { useVerge } from '@/hooks/use-verge'
import { debugLog } from '@/utils/debug'
import parseTraffic from '@/utils/parse-traffic'
import {
  formatTrafficHourMinute,
  formatTrafficMinuteSecond,
  formatTrafficName,
} from '@/utils/traffic-sampler'

// 流量数据项接口
interface ITrafficItem {
  up: number
  down: number
  timestamp?: number
}

// 对外暴露的接口
export interface EnhancedCanvasTrafficGraphRef {
  appendData: (data: ITrafficItem) => void
  toggleStyle: () => void
}

type TimeRange = 1 | 5 | 10 // 分钟

// 悬浮提示数据接口
interface TooltipData {
  x: number
  y: number
  upSpeed: string
  downSpeed: string
  timestamp: string
  visible: boolean
  dataIndex: number // 添加数据索引用于高亮
  highlightY: number // 高亮Y轴位置
}

const MAX_POINTS = 300
const TARGET_FPS = 15 // 降低帧率减少闪烁
const LINE_WIDTH_UP = 2.5
const LINE_WIDTH_DOWN = 2.5
const LINE_WIDTH_GRID = 0.5
const ALPHA_GRADIENT = 0.15 // 降低渐变透明度
const ALPHA_LINE = 0.9
const PADDING_TOP = 16
const PADDING_RIGHT = 16 // 增加右边距确保时间戳完整显示
const PADDING_BOTTOM = 32 // 进一步增加底部空间给时间轴和统计信息
const PADDING_LEFT = 35 // 增加左边距为Y轴标签留出空间

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

interface EnhancedCanvasTrafficGraphProps {
  ref?: Ref<EnhancedCanvasTrafficGraphRef>
}

const isSameTrafficData = (
  current: ITrafficDataPoint[],
  next: ITrafficDataPoint[],
) => {
  if (current === next) return true
  if (current.length !== next.length) return false

  for (let i = 0; i < current.length; i++) {
    const currentPoint = current[i]
    const nextPoint = next[i]

    if (
      currentPoint.timestamp !== nextPoint.timestamp ||
      currentPoint.up !== nextPoint.up ||
      currentPoint.down !== nextPoint.down
    ) {
      return false
    }
  }

  return true
}

const displayDataReducer = (
  current: ITrafficDataPoint[],
  payload: ITrafficDataPoint[],
): ITrafficDataPoint[] =>
  isSameTrafficData(current, payload) ? current : payload

/**
 * 稳定版Canvas流量图表组件
 * 修复闪烁问题，添加时间轴显示
 */
export const EnhancedCanvasTrafficGraph = memo(
  function EnhancedCanvasTrafficGraph({
    ref,
  }: EnhancedCanvasTrafficGraphProps) {
    const theme = useTheme()
    const { t } = useTranslation()
    const verge = useVerge()
    const pause_render_traffic_stats_on_blur =
      verge.verge?.pause_render_traffic_stats_on_blur ?? true

    // 使用增强版全局流量数据管理
    const { dataPoints, requestRange, samplerStats } =
      useTrafficGraphDataEnhanced()

    // 基础状态
    const [timeRange, setTimeRange] = useState<TimeRange>(10)
    const [chartStyle, setChartStyle] = useState<'bezier' | 'line'>('bezier')

    const initialFocusState =
      typeof document !== 'undefined' ? !document.hidden : true
    const [isWindowFocused, setIsWindowFocused] = useState(initialFocusState)
    const [isDocumentVisible, setIsDocumentVisible] =
      useState(initialFocusState)
    const isDocumentVisibleRef = useRef(initialFocusState)

    // 悬浮提示状态
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

    // Canvas引用和渲染状态
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const hoverCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawFrameRef = useRef<number | undefined>(undefined)
    const hoverFrameRef = useRef<number | undefined>(undefined)
    const mouseMoveFrameRef = useRef<number | undefined>(undefined)
    const scheduleDrawGraphRef = useRef<() => void>(() => {})
    const pendingMousePositionRef = useRef<{
      clientX: number
      clientY: number
    } | null>(null)
    const isWindowFocusedRef = useRef<boolean>(initialFocusState)
    const lastDataTimestampRef = useRef<number>(0)
    const dataStaleRef = useRef<boolean>(false)

    // 当前显示的数据缓存
    const [displayData, dispatchDisplayData] = useReducer(
      displayDataReducer,
      [],
    )
    const debounceTimeoutRef = useRef<number | null>(null)
    const [currentFPS, setCurrentFPS] = useState(GRAPH_CONFIG.targetFPS)

    // 主题颜色配置
    const colors = useMemo(
      () => ({
        up: theme.palette.secondary.main,
        down: theme.palette.primary.main,
        grid: theme.palette.divider,
        text: theme.palette.text.secondary,
        background: theme.palette.background.paper,
      }),
      [theme],
    )

    // 更新显示数据（防抖处理）
    const updateDisplayData = useCallback((newData: ITrafficDataPoint[]) => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current)
      }
      debounceTimeoutRef.current = window.setTimeout(() => {
        dispatchDisplayData(newData)
      }, 50) // 50ms防抖
    }, [])

    // 监听数据变化
    useEffect(() => {
      updateDisplayData(dataPoints)

      return () => {
        if (debounceTimeoutRef.current !== null) {
          window.clearTimeout(debounceTimeoutRef.current)
          debounceTimeoutRef.current = null
        }
      }
    }, [dataPoints, updateDisplayData])

    useEffect(() => {
      requestRange(timeRange)
    }, [requestRange, timeRange])

    useEffect(() => {
      if (displayData.length === 0) {
        lastDataTimestampRef.current = 0
        dataStaleRef.current = false
        // eslint-disable-next-line @eslint-react/set-state-in-effect
        setCurrentFPS(GRAPH_CONFIG.targetFPS)
        return
      }

      const latestTimestamp =
        displayData[displayData.length - 1]?.timestamp ?? null
      if (latestTimestamp) {
        lastDataTimestampRef.current = latestTimestamp
        const age = Date.now() - latestTimestamp
        const stale = age > STALE_DATA_THRESHOLD
        dataStaleRef.current = stale
      } else {
        dataStaleRef.current = false
      }
    }, [displayData])

    const handleFocusStateChange = useCallback(
      (focused: boolean) => {
        isWindowFocusedRef.current = focused
        setIsWindowFocused(focused)

        if (focused || !pause_render_traffic_stats_on_blur) {
          setCurrentFPS(GRAPH_CONFIG.targetFPS)
        }
      },
      [pause_render_traffic_stats_on_blur],
    )

    useEffect(() => {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return
      }

      const handleFocus = () => handleFocusStateChange(true)
      const handleBlur = () => handleFocusStateChange(false)
      const handleVisibilityChange = () => {
        const visible = !document.hidden
        isDocumentVisibleRef.current = visible
        setIsDocumentVisible(visible)
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
    }, [handleFocusStateChange])

    // Y轴坐标计算 - 线性映射
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

    const yScale = useMemo(
      () => computeYScale(displayData),
      [computeYScale, displayData],
    )

    // 鼠标悬浮处理 - 计算最近的数据点
    const handleMouseMove = useCallback(
      (event: React.MouseEvent<HTMLElement>) => {
        if (displayData.length === 0) return

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
          if (!canvas || displayData.length === 0) return

          const rect = canvas.getBoundingClientRect()
          const mouseX = pendingMousePosition.clientX - rect.left
          const mouseY = pendingMousePosition.clientY - rect.top

          const padding = GRAPH_CONFIG.padding
          const effectiveWidth = rect.width - padding.left - padding.right
          if (effectiveWidth <= 0) return

          // 计算最接近的数据点索引
          const relativeMouseX = mouseX - padding.left
          const ratio = Math.max(
            0,
            Math.min(1, relativeMouseX / effectiveWidth),
          )
          const dataIndex = Math.round(ratio * (displayData.length - 1))

          if (dataIndex < 0 || dataIndex >= displayData.length) return

          const dataPoint = displayData[dataIndex]

          // 格式化流量数据
          const [upValue, upUnit] = parseTraffic(dataPoint.up)
          const [downValue, downUnit] = parseTraffic(dataPoint.down)

          // 格式化时间戳
          const timeStr = dataPoint.timestamp
            ? formatTrafficName(dataPoint.timestamp)
            : '未知时间'

          // 计算数据点对应的Y坐标位置（用于高亮）
          const { topValue: tvH, bottomValue: bvH } = yScale
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
      [displayData, calculateY, yScale],
    )

    // 鼠标离开处理
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

    // 获取智能Y轴刻度（三刻度系统：最小值、中间值、最大值）
    const getYAxisTicks = useCallback(
      (topValue: number, bottomValue: number, height: number) => {
        // 格式化流量数值
        const formatTrafficValue = (bytes: number): string => {
          if (bytes === 0) return '0'
          if (bytes < 1024) return `${Math.round(bytes)}B`
          if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
          return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
        }

        const padding = GRAPH_CONFIG.padding

        // 强制显示三个刻度：底部、中间、顶部
        const topY = padding.top + 10 // 避免与顶部时间范围按钮重叠
        const bottomY = height - padding.bottom - 5 // 避免与底部时间轴重叠
        const middleY = (topY + bottomY) / 2
        const middleValue = (bottomValue + topValue) / 2

        // 创建三个固定位置的刻度
        const ticks = [
          {
            value: bottomValue,
            label: formatTrafficValue(bottomValue),
            y: bottomY,
          },
          {
            value: middleValue,
            label: formatTrafficValue(middleValue),
            y: middleY,
          },
          {
            value: topValue,
            label: formatTrafficValue(topValue),
            y: topY,
          },
        ]

        return ticks
      },
      [],
    )

    // 绘制Y轴刻度线和标签
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

        if (ticks.length === 0) return

        ctx.save()

        ticks.forEach((tick, index) => {
          const isBottomTick = index === 0 // 最底部的刻度
          const isTopTick = index === ticks.length - 1 // 最顶部的刻度

          // 绘制水平刻度线，只绘制关键刻度线
          if (isBottomTick || isTopTick) {
            ctx.strokeStyle = colors.grid
            ctx.lineWidth = isBottomTick ? 0.8 : 0.4 // 底部刻度线稍粗
            ctx.globalAlpha = isBottomTick ? 0.25 : 0.15

            ctx.beginPath()
            ctx.moveTo(padding.left, tick.y)
            ctx.lineTo(width - padding.right, tick.y)
            ctx.stroke()
          }

          // 绘制Y轴标签
          ctx.fillStyle = colors.text
          ctx.font =
            "8px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
          ctx.globalAlpha = 0.9
          ctx.textAlign = 'right'
          ctx.textBaseline = 'middle'

          // 为标签添加更清晰的背景（仅在必要时）
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

          // 绘制标签文字
          ctx.globalAlpha = 0.9
          ctx.fillStyle = colors.text
          ctx.fillText(tick.label, padding.left - 4, tick.y)
        })

        ctx.restore()
      },
      [colors.grid, colors.text, colors.background, getYAxisTicks],
    )

    // 获取时间范围对应的最佳时间显示策略
    const getTimeDisplayStrategy = useCallback(
      (timeRangeMinutes: TimeRange) => {
        switch (timeRangeMinutes) {
          case 1: // 1分钟：更密集的时间标签，显示 MM:SS
            return {
              maxLabels: 6, // 减少到6个，更适合短时间
              formatTime: formatTrafficMinuteSecond,
              intervalSeconds: 10, // 每10秒一个标签，更合理
              minPixelDistance: 35, // 减少间距，允许更多标签
            }
          case 5: // 5分钟：中等密度，显示 HH:MM
            return {
              maxLabels: 6, // 6个标签比较合适
              formatTime: formatTrafficHourMinute,
              intervalSeconds: 30, // 约30秒间隔
              minPixelDistance: 38, // 减少间距，允许更多标签
            }
          case 10: // 10分钟：标准密度，显示 HH:MM
          default:
            return {
              maxLabels: 8, // 保持8个
              formatTime: formatTrafficHourMinute,
              intervalSeconds: 60, // 1分钟间隔
              minPixelDistance: 40, // 减少间距，允许更多标签
            }
        }
      },
      [],
    )

    // 绘制时间轴
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

        const strategy = getTimeDisplayStrategy(timeRange)

        ctx.save()
        ctx.fillStyle = colors.text
        ctx.font =
          "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
        ctx.globalAlpha = 0.7

        // 根据数据长度和时间范围智能选择显示间隔
        const targetLabels = Math.min(strategy.maxLabels, data.length)
        const step = Math.max(1, Math.floor(data.length / (targetLabels - 1)))

        // 使用策略中定义的最小像素间距
        const minPixelDistance = strategy.minPixelDistance || 45
        const actualStep = Math.max(
          step,
          Math.ceil((data.length * minPixelDistance) / effectiveWidth),
        )

        // 收集要显示的时间点
        const timePoints: Array<{ index: number; x: number; label: string }> =
          []

        // 添加第一个时间点
        if (data.length > 0 && data[0].timestamp) {
          timePoints.push({
            index: 0,
            x: padding.left,
            label: strategy.formatTime(data[0].timestamp),
          })
        }

        // 添加中间的时间点
        for (
          let i = actualStep;
          i < data.length - actualStep;
          i += actualStep
        ) {
          const point = data[i]
          if (!point.timestamp) continue

          const x = padding.left + (i / (data.length - 1)) * effectiveWidth
          timePoints.push({
            index: i,
            x,
            label: strategy.formatTime(point.timestamp),
          })
        }

        // 添加最后一个时间点（如果不会与前面的重叠）
        if (data.length > 1 && data[data.length - 1].timestamp) {
          const lastX = width - padding.right
          const lastPoint = timePoints[timePoints.length - 1]

          // 确保最后一个标签与前一个标签有足够间距
          if (!lastPoint || lastX - lastPoint.x >= minPixelDistance) {
            timePoints.push({
              index: data.length - 1,
              x: lastX,
              label: strategy.formatTime(data[data.length - 1].timestamp),
            })
          }
        }

        // 绘制时间标签
        timePoints.forEach((point, index) => {
          if (index === 0) {
            // 第一个标签左对齐
            ctx.textAlign = 'left'
          } else if (index === timePoints.length - 1) {
            // 最后一个标签右对齐
            ctx.textAlign = 'right'
          } else {
            // 中间标签居中对齐
            ctx.textAlign = 'center'
          }

          ctx.fillText(point.label, point.x, timeAxisY)
        })

        ctx.restore()
      },
      [colors.text, timeRange, getTimeDisplayStrategy],
    )

    // 绘制网格线
    const drawGrid = useCallback(
      (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        const padding = GRAPH_CONFIG.padding
        const effectiveWidth = width - padding.left - padding.right
        const effectiveHeight = height - padding.top - padding.bottom

        ctx.save()
        ctx.strokeStyle = colors.grid
        ctx.lineWidth = GRAPH_CONFIG.lineWidth.grid
        ctx.globalAlpha = 0.7

        // 水平网格线
        const horizontalLines = 4
        for (let i = 1; i <= horizontalLines; i++) {
          const y = padding.top + (effectiveHeight / (horizontalLines + 1)) * i
          ctx.beginPath()
          ctx.moveTo(padding.left, y)
          ctx.lineTo(width - padding.right, y)
          ctx.stroke()
        }

        // 垂直网格线
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

    // 绘制流量线条
    const drawTrafficLine = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        data: ITrafficDataPoint[],
        valueKey: 'up' | 'down',
        width: number,
        height: number,
        color: string,
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

        // 绘制渐变填充
        if (withGradient && chartStyle === 'bezier') {
          const gradient = ctx.createLinearGradient(
            0,
            padding.top,
            0,
            height - padding.bottom,
          )
          gradient.addColorStop(
            0,
            `${color}${Math.round(GRAPH_CONFIG.alpha.gradient * 255)
              .toString(16)
              .padStart(2, '0')}`,
          )
          gradient.addColorStop(1, `${color}00`)

          ctx.beginPath()
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

          ctx.lineTo(getX(lastIndex), height - padding.bottom)
          ctx.lineTo(getX(0), height - padding.bottom)
          ctx.closePath()
          ctx.fillStyle = gradient
          ctx.fill()
        }

        // 绘制主线条
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

    // 主绘制函数
    const drawGraph = useCallback(() => {
      const canvas = canvasRef.current
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

      const { topValue, bottomValue } = yScale

      // 绘制Y轴刻度线（背景层）
      drawYAxis(ctx, cssWidth, cssHeight, topValue, bottomValue)

      // 绘制网格
      drawGrid(ctx, cssWidth, cssHeight)

      // 绘制时间轴
      drawTimeAxis(ctx, cssWidth, cssHeight, displayData)

      // 绘制下载线（背景层）
      drawTrafficLine(
        ctx,
        displayData,
        'down',
        cssWidth,
        cssHeight,
        colors.down,
        true,
        topValue,
        bottomValue,
      )

      // 绘制上传线（前景层）
      drawTrafficLine(
        ctx,
        displayData,
        'up',
        cssWidth,
        cssHeight,
        colors.up,
        true,
        topValue,
        bottomValue,
      )

      clearCanvas(hoverCanvasRef.current)
    }, [
      displayData,
      colors,
      yScale,
      drawYAxis,
      drawGrid,
      drawTimeAxis,
      drawTrafficLine,
      syncCanvasSize,
      clearCanvas,
    ])

    const drawHoverOverlay = useCallback(() => {
      const canvas = hoverCanvasRef.current
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
        ctx.setLineDash([4, 4]) // 虚线效果

        // 绘制垂直指示线
        ctx.beginPath()
        ctx.moveTo(dataX, padding.top)
        ctx.lineTo(dataX, cssHeight - padding.bottom)
        ctx.stroke()

        // 绘制水平指示线（高亮Y轴位置）
        ctx.beginPath()
        ctx.moveTo(padding.left, currentTooltip.highlightY)
        ctx.lineTo(cssWidth - padding.right, currentTooltip.highlightY)
        ctx.stroke()

        ctx.restore()
      }
    }, [displayData, colors, syncCanvasSize, clearCanvas])

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

    useEffect(() => {
      tooltipDataRef.current = tooltipData
      scheduleHoverDraw()
    }, [tooltipData, scheduleHoverDraw])

    useEffect(() => {
      scheduleDrawGraph()
    }, [scheduleDrawGraph, isDocumentVisible, isWindowFocused])

    useEffect(() => {
      scheduleDrawGraphRef.current = scheduleDrawGraph
    }, [scheduleDrawGraph])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || typeof window === 'undefined') return

      if (typeof ResizeObserver === 'undefined') {
        const handleResize = () => scheduleDrawGraphRef.current()
        window.addEventListener('resize', handleResize)
        return () => {
          window.removeEventListener('resize', handleResize)
        }
      }

      const resizeObserver = new ResizeObserver(() =>
        scheduleDrawGraphRef.current(),
      )
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

    // 切换时间范围
    const handleTimeRangeClick = useCallback((event: React.MouseEvent) => {
      event.stopPropagation()
      setTimeRange((prev) => {
        return prev === 1 ? 5 : prev === 5 ? 10 : 1
      })
    }, [])

    // 切换图表样式
    const toggleStyle = useCallback(() => {
      setChartStyle((prev) => (prev === 'bezier' ? 'line' : 'bezier'))
    }, [])

    // 兼容性方法
    const appendData = useCallback((data: ITrafficItem) => {
      debugLog(
        '[EnhancedCanvasTrafficGraphV2] appendData called (using global data):',
        data,
      )
    }, [])

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        appendData,
        toggleStyle,
      }),
      [appendData, toggleStyle],
    )

    // 获取时间范围文本
    const getTimeRangeText = useCallback(() => {
      return t('home.components.traffic.patterns.minutes', {
        time: timeRange,
      })
    }, [timeRange, t])

    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          position: 'relative',
          bgcolor: 'action.hover',
          borderRadius: 1,
          cursor: 'pointer',
          overflow: 'hidden',
        }}
        onClick={toggleStyle}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
          }}
          onClick={toggleStyle}
        />

        {tooltipData.visible && (
          <canvas
            ref={hoverCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* 控制层覆盖 */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
          }}
        >
          {/* 时间范围按钮 */}
          <Box
            component="div"
            onClick={handleTimeRangeClick}
            sx={{
              position: 'absolute',
              top: 6,
              left: 40, // 向右移动，避免与Y轴最大值标签重叠
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
            }}
          >
            {getTimeRangeText()}
          </Box>

          {/* 图例 */}
          <Box
            sx={{
              position: 'absolute',
              top: 6,
              right: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <Box
              sx={{
                fontSize: '11px',
                fontWeight: 'bold',
                color: colors.up,
                textAlign: 'right',
              }}
            >
              {t('home.components.traffic.legends.upload')}
            </Box>
            <Box
              sx={{
                fontSize: '11px',
                fontWeight: 'bold',
                color: colors.down,
                textAlign: 'right',
              }}
            >
              {t('home.components.traffic.legends.download')}
            </Box>
          </Box>

          {/* 样式指示器 */}
          <Box
            sx={{
              position: 'absolute',
              bottom: 6,
              right: 8,
              fontSize: '10px',
              color: 'text.disabled',
              opacity: 0.7,
            }}
          >
            {chartStyle === 'bezier' ? 'Smooth' : 'Linear'}
          </Box>

          {/* 数据统计指示器（左下角） */}
          <Box
            sx={{
              position: 'absolute',
              bottom: 6,
              left: 8,
              fontSize: '9px',
              color: 'text.disabled',
              opacity: 0.6,
              lineHeight: 1.2,
            }}
          >
            Points: {displayData.length} | Compressed:{' '}
            {samplerStats.compressedBufferSize} | FPS: {currentFPS}
          </Box>

          {/* 悬浮提示框 */}
          {tooltipData.visible && (
            <Box
              sx={{
                position: 'absolute',
                left: tooltipData.x + 8,
                top: tooltipData.y - 8,
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
              <Box sx={{ color: 'text.secondary', mb: 0.2 }}>
                {tooltipData.timestamp}
              </Box>
              <Box sx={{ color: 'secondary.main', fontWeight: 500 }}>
                ↑ {tooltipData.upSpeed}
              </Box>
              <Box sx={{ color: 'primary.main', fontWeight: 500 }}>
                ↓ {tooltipData.downSpeed}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    )
  },
)

EnhancedCanvasTrafficGraph.displayName = 'EnhancedCanvasTrafficGraph'
