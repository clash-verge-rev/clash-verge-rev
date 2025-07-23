import {
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
} from "react";
import { Box, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  useTrafficGraphDataEnhanced,
  type ITrafficDataPoint,
} from "@/hooks/use-traffic-monitor-enhanced";

// 流量数据项接口
export interface ITrafficItem {
  up: number;
  down: number;
  timestamp?: number;
}

// 对外暴露的接口
export interface EnhancedCanvasTrafficGraphRef {
  appendData: (data: ITrafficItem) => void;
  toggleStyle: () => void;
}

type TimeRange = 1 | 5 | 10; // 分钟

// Canvas图表配置
const MAX_POINTS = 300;
const TARGET_FPS = 15; // 降低帧率减少闪烁
const LINE_WIDTH_UP = 2.5;
const LINE_WIDTH_DOWN = 2.5;
const LINE_WIDTH_GRID = 0.5;
const ALPHA_GRADIENT = 0.15; // 降低渐变透明度
const ALPHA_LINE = 0.9;
const PADDING_TOP = 16;
const PADDING_RIGHT = 16; // 增加右边距确保时间戳完整显示
const PADDING_BOTTOM = 32; // 进一步增加底部空间给时间轴和统计信息
const PADDING_LEFT = 16; // 增加左边距确保时间戳完整显示

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
};

/**
 * 稳定版Canvas流量图表组件
 * 修复闪烁问题，添加时间轴显示
 */
export const EnhancedCanvasTrafficGraph = memo(
  forwardRef<EnhancedCanvasTrafficGraphRef>((props, ref) => {
    const theme = useTheme();
    const { t } = useTranslation();

    // 使用增强版全局流量数据管理
    const { dataPoints, getDataForTimeRange, isDataFresh, samplerStats } =
      useTrafficGraphDataEnhanced();

    // 基础状态
    const [timeRange, setTimeRange] = useState<TimeRange>(10);
    const [chartStyle, setChartStyle] = useState<"bezier" | "line">("bezier");

    // Canvas引用和渲染状态
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const lastRenderTimeRef = useRef<number>(0);
    const isInitializedRef = useRef<boolean>(false);

    // 当前显示的数据缓存
    const [displayData, setDisplayData] = useState<ITrafficDataPoint[]>([]);

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
    );

    // 根据时间范围获取数据点数量
    const getPointsForTimeRange = useCallback(
      (minutes: TimeRange): number =>
        Math.min(minutes * 60, GRAPH_CONFIG.maxPoints),
      [],
    );

    // 更新显示数据（防抖处理）
    const updateDisplayDataDebounced = useMemo(() => {
      let timeoutId: number;
      return (newData: ITrafficDataPoint[]) => {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          setDisplayData(newData);
        }, 50); // 50ms防抖
      };
    }, []);

    // 监听数据变化
    useEffect(() => {
      const timeRangeData = getDataForTimeRange(timeRange);
      updateDisplayDataDebounced(timeRangeData);
    }, [
      dataPoints,
      timeRange,
      getDataForTimeRange,
      updateDisplayDataDebounced,
    ]);

    // Y轴坐标计算（对数刻度）- 确保不与时间轴重叠
    const calculateY = useCallback((value: number, height: number): number => {
      const padding = GRAPH_CONFIG.padding;
      const effectiveHeight = height - padding.top - padding.bottom;
      const baseY = height - padding.bottom;

      if (value === 0) return baseY - 2; // 稍微抬高零值线

      const steps = effectiveHeight / 7;

      if (value <= 10) return baseY - (value / 10) * steps;
      if (value <= 100) return baseY - (value / 100 + 1) * steps;
      if (value <= 1024) return baseY - (value / 1024 + 2) * steps;
      if (value <= 10240) return baseY - (value / 10240 + 3) * steps;
      if (value <= 102400) return baseY - (value / 102400 + 4) * steps;
      if (value <= 1048576) return baseY - (value / 1048576 + 5) * steps;
      if (value <= 10485760) return baseY - (value / 10485760 + 6) * steps;

      return padding.top + 1;
    }, []);

    // 绘制时间轴
    const drawTimeAxis = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        data: ITrafficDataPoint[],
      ) => {
        if (data.length === 0) return;

        const padding = GRAPH_CONFIG.padding;
        const effectiveWidth = width - padding.left - padding.right;
        const timeAxisY = height - padding.bottom + 14;

        ctx.save();
        ctx.fillStyle = colors.text;
        ctx.font =
          "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
        ctx.globalAlpha = 0.7;

        // 显示最多6个时间标签，确保边界完整显示
        const maxLabels = 6;
        const step = Math.max(1, Math.floor(data.length / (maxLabels - 1)));

        // 绘制第一个时间点（左对齐）
        if (data.length > 0 && data[0].name) {
          ctx.textAlign = "left";
          const timeLabel = data[0].name.substring(0, 5);
          ctx.fillText(timeLabel, padding.left, timeAxisY);
        }

        // 绘制中间的时间点（居中对齐）
        ctx.textAlign = "center";
        for (let i = step; i < data.length - step; i += step) {
          const point = data[i];
          if (!point.name) continue;

          const x = padding.left + (i / (data.length - 1)) * effectiveWidth;
          const timeLabel = point.name.substring(0, 5);
          ctx.fillText(timeLabel, x, timeAxisY);
        }

        // 绘制最后一个时间点（右对齐）
        if (data.length > 1 && data[data.length - 1].name) {
          ctx.textAlign = "right";
          const timeLabel = data[data.length - 1].name.substring(0, 5);
          ctx.fillText(timeLabel, width - padding.right, timeAxisY);
        }

        ctx.restore();
      },
      [colors.text],
    );

    // 绘制网格线
    const drawGrid = useCallback(
      (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        const padding = GRAPH_CONFIG.padding;
        const effectiveWidth = width - padding.left - padding.right;
        const effectiveHeight = height - padding.top - padding.bottom;

        ctx.save();
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = GRAPH_CONFIG.lineWidth.grid;
        ctx.globalAlpha = 0.2;

        // 水平网格线
        const horizontalLines = 4;
        for (let i = 1; i <= horizontalLines; i++) {
          const y = padding.top + (effectiveHeight / (horizontalLines + 1)) * i;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(width - padding.right, y);
          ctx.stroke();
        }

        // 垂直网格线
        const verticalLines = 6;
        for (let i = 1; i <= verticalLines; i++) {
          const x = padding.left + (effectiveWidth / (verticalLines + 1)) * i;
          ctx.beginPath();
          ctx.moveTo(x, padding.top);
          ctx.lineTo(x, height - padding.bottom);
          ctx.stroke();
        }

        ctx.restore();
      },
      [colors.grid],
    );

    // 绘制流量线条
    const drawTrafficLine = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        values: number[],
        width: number,
        height: number,
        color: string,
        withGradient = false,
      ) => {
        if (values.length < 2) return;

        const padding = GRAPH_CONFIG.padding;
        const effectiveWidth = width - padding.left - padding.right;

        const points = values.map((value, index) => [
          padding.left + (index / (values.length - 1)) * effectiveWidth,
          calculateY(value, height),
        ]);

        ctx.save();

        // 绘制渐变填充
        if (withGradient && chartStyle === "bezier") {
          const gradient = ctx.createLinearGradient(
            0,
            padding.top,
            0,
            height - padding.bottom,
          );
          gradient.addColorStop(
            0,
            `${color}${Math.round(GRAPH_CONFIG.alpha.gradient * 255)
              .toString(16)
              .padStart(2, "0")}`,
          );
          gradient.addColorStop(1, `${color}00`);

          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);

          if (chartStyle === "bezier") {
            for (let i = 1; i < points.length; i++) {
              const current = points[i];
              const next = points[i + 1] || current;
              const controlX = (current[0] + next[0]) / 2;
              const controlY = (current[1] + next[1]) / 2;
              ctx.quadraticCurveTo(current[0], current[1], controlX, controlY);
            }
          } else {
            for (let i = 1; i < points.length; i++) {
              ctx.lineTo(points[i][0], points[i][1]);
            }
          }

          ctx.lineTo(points[points.length - 1][0], height - padding.bottom);
          ctx.lineTo(points[0][0], height - padding.bottom);
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // 绘制主线条
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = GRAPH_CONFIG.lineWidth.up;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = GRAPH_CONFIG.alpha.line;

        ctx.moveTo(points[0][0], points[0][1]);

        if (chartStyle === "bezier") {
          for (let i = 1; i < points.length; i++) {
            const current = points[i];
            const next = points[i + 1] || current;
            const controlX = (current[0] + next[0]) / 2;
            const controlY = (current[1] + next[1]) / 2;
            ctx.quadraticCurveTo(current[0], current[1], controlX, controlY);
          }
        } else {
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i][0], points[i][1]);
          }
        }

        ctx.stroke();
        ctx.restore();
      },
      [calculateY, chartStyle],
    );

    // 主绘制函数
    const drawGraph = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || displayData.length === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Canvas尺寸设置
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      // 只在尺寸变化时重新设置Canvas
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
      }

      // 清空画布
      ctx.clearRect(0, 0, width, height);

      // 绘制网格
      drawGrid(ctx, width, height);

      // 绘制时间轴
      drawTimeAxis(ctx, width, height, displayData);

      // 提取流量数据
      const upValues = displayData.map((d) => d.up);
      const downValues = displayData.map((d) => d.down);

      // 绘制下载线（背景层）
      drawTrafficLine(ctx, downValues, width, height, colors.down, true);

      // 绘制上传线（前景层）
      drawTrafficLine(ctx, upValues, width, height, colors.up, true);

      isInitializedRef.current = true;
    }, [displayData, colors, drawGrid, drawTimeAxis, drawTrafficLine]);

    // 受控的动画循环
    useEffect(() => {
      const animate = (currentTime: number) => {
        // 控制帧率，减少不必要的重绘
        if (
          currentTime - lastRenderTimeRef.current >=
          1000 / GRAPH_CONFIG.targetFPS
        ) {
          drawGraph();
          lastRenderTimeRef.current = currentTime;
        }
        animationFrameRef.current = requestAnimationFrame(animate);
      };

      // 只有在有数据时才开始动画
      if (displayData.length > 0) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [drawGraph, displayData.length]);

    // 切换时间范围
    const handleTimeRangeClick = useCallback((event: React.MouseEvent) => {
      event.stopPropagation();
      setTimeRange((prev) => {
        return prev === 1 ? 5 : prev === 5 ? 10 : 1;
      });
    }, []);

    // 切换图表样式
    const toggleStyle = useCallback(() => {
      setChartStyle((prev) => (prev === "bezier" ? "line" : "bezier"));
    }, []);

    // 兼容性方法
    const appendData = useCallback((data: ITrafficItem) => {
      console.log(
        "[EnhancedCanvasTrafficGraphV2] appendData called (using global data):",
        data,
      );
    }, []);

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        appendData,
        toggleStyle,
      }),
      [appendData, toggleStyle],
    );

    // 获取时间范围文本
    const getTimeRangeText = useCallback(() => {
      return t("{{time}} Minutes", { time: timeRange });
    }, [timeRange, t]);

    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          position: "relative",
          bgcolor: "action.hover",
          borderRadius: 1,
          cursor: "pointer",
          overflow: "hidden",
        }}
        onClick={toggleStyle}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
          }}
        />

        {/* 控制层覆盖 */}
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
          }}
        >
          {/* 时间范围按钮 */}
          <Box
            component="div"
            onClick={handleTimeRangeClick}
            sx={{
              position: "absolute",
              top: 6,
              left: 8,
              fontSize: "11px",
              fontWeight: "bold",
              color: "text.secondary",
              cursor: "pointer",
              pointerEvents: "all",
              px: 1,
              py: 0.5,
              borderRadius: 0.5,
              bgcolor: "rgba(0,0,0,0.05)",
              "&:hover": {
                bgcolor: "rgba(0,0,0,0.1)",
              },
            }}
          >
            {getTimeRangeText()}
          </Box>

          {/* 图例 */}
          <Box
            sx={{
              position: "absolute",
              top: 6,
              right: 8,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            <Box
              sx={{
                fontSize: "11px",
                fontWeight: "bold",
                color: colors.up,
                textAlign: "right",
              }}
            >
              {t("Upload")}
            </Box>
            <Box
              sx={{
                fontSize: "11px",
                fontWeight: "bold",
                color: colors.down,
                textAlign: "right",
              }}
            >
              {t("Download")}
            </Box>
          </Box>

          {/* 样式指示器 */}
          <Box
            sx={{
              position: "absolute",
              bottom: 6,
              right: 8,
              fontSize: "10px",
              color: "text.disabled",
              opacity: 0.7,
            }}
          >
            {chartStyle === "bezier" ? "Smooth" : "Linear"}
          </Box>

          {/* 数据统计指示器（左下角） */}
          <Box
            sx={{
              position: "absolute",
              bottom: 6,
              left: 8,
              fontSize: "9px",
              color: "text.disabled",
              opacity: 0.6,
              lineHeight: 1.2,
            }}
          >
            Points: {displayData.length} | Fresh: {isDataFresh ? "✓" : "✗"} |
            Compressed: {samplerStats.compressedBufferSize}
          </Box>
        </Box>
      </Box>
    );
  }),
);

EnhancedCanvasTrafficGraph.displayName = "EnhancedCanvasTrafficGraph";
