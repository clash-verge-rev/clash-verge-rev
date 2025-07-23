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
const GRAPH_CONFIG = {
  maxPoints: 300, // 增加点数以支持更长时间范围
  frameRate: 30, // 30fps动画
  lineWidth: {
    up: 3,
    down: 3,
    reference: 1,
  },
  alpha: {
    up: 0.8,
    down: 0.9,
    upGradient: 0.3,
    downGradient: 0.2,
  },
};

/**
 * 增强版Canvas流量图表组件
 * 基于原始Canvas实现，添加渐变效果和数据管理增强
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

    // Canvas引用和动画状态
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | undefined>(undefined);
    const displayDataRef = useRef<ITrafficDataPoint[]>([]);
    const offsetRef = useRef(0);
    const lastDrawTimeRef = useRef(0);

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

    // 根据时间范围计算显示的数据点数量
    const getPointsForTimeRange = useCallback(
      (minutes: TimeRange): number =>
        Math.min(minutes * 60, GRAPH_CONFIG.maxPoints),
      [],
    );

    // 数据标准化函数 - 转换为Canvas绘制用的格式
    const normalizeData = useCallback(
      (data: ITrafficDataPoint[]) => {
        const maxPoints = getPointsForTimeRange(timeRange);
        if (data.length === 0) {
          return Array(maxPoints).fill({ up: 0, down: 0 });
        }

        // 如果数据不足，用0填充前面
        const result = [...data];
        while (result.length < maxPoints) {
          result.unshift({ up: 0, down: 0, timestamp: 0, name: "" });
        }

        // 如果数据过多，保留最新的
        if (result.length > maxPoints) {
          return result.slice(-maxPoints);
        }

        return result.map((point) => ({ up: point.up, down: point.down }));
      },
      [timeRange, getPointsForTimeRange],
    );

    // 更新显示数据
    useEffect(() => {
      const timeRangeData = getDataForTimeRange(timeRange);
      displayDataRef.current = timeRangeData;
    }, [dataPoints, timeRange, getDataForTimeRange]);

    // Y轴坐标计算（对数刻度，与原实现一致）
    const calculateY = useCallback((value: number, height: number): number => {
      if (value === 0) return height - 1;

      const dy = height / 7;

      if (value <= 10) return height - (value / 10) * dy;
      if (value <= 100) return height - (value / 100 + 1) * dy;
      if (value <= 1024) return height - (value / 1024 + 2) * dy;
      if (value <= 10240) return height - (value / 10240 + 3) * dy;
      if (value <= 102400) return height - (value / 102400 + 4) * dy;
      if (value <= 1048576) return height - (value / 1048576 + 5) * dy;
      if (value <= 10485760) return height - (value / 10485760 + 6) * dy;

      return 1;
    }, []);

    // 绘制贝塞尔曲线
    const drawBezierLine = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        values: number[],
        width: number,
        height: number,
        color: string,
        lineWidth: number,
        withGradient = false,
        gradientAlpha = 0.2,
      ) => {
        if (values.length < 2) return;

        const dx = width / (values.length - 1);
        const points = values.map((value, index) => [
          index * dx,
          calculateY(value, height),
        ]);

        ctx.save();

        // 绘制渐变填充（如果启用）
        if (withGradient && chartStyle === "bezier") {
          const gradient = ctx.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(
            0,
            `${color}${Math.round(gradientAlpha * 255)
              .toString(16)
              .padStart(2, "0")}`,
          );
          gradient.addColorStop(1, `${color}00`);

          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);

          // 绘制贝塞尔曲线路径
          for (let i = 1; i < points.length; i++) {
            const current = points[i];
            const next = points[i + 1] || current;
            const controlX = (current[0] + next[0]) / 2;
            const controlY = (current[1] + next[1]) / 2;
            ctx.quadraticCurveTo(current[0], current[1], controlX, controlY);
          }

          // 闭合路径进行填充
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // 绘制线条
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.moveTo(points[0][0], points[0][1]);

        if (chartStyle === "bezier") {
          // 贝塞尔曲线
          for (let i = 1; i < points.length; i++) {
            const current = points[i];
            const next = points[i + 1] || current;
            const controlX = (current[0] + next[0]) / 2;
            const controlY = (current[1] + next[1]) / 2;
            ctx.quadraticCurveTo(current[0], current[1], controlX, controlY);
          }
        } else {
          // 直线
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
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height } = canvas;
      const normalizedData = normalizeData(displayDataRef.current);

      // 清空画布
      ctx.clearRect(0, 0, width, height);

      // 设置高DPI支持
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
      }

      // 绘制网格线（可选）
      ctx.save();
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.3;

      // 水平网格线
      const gridLines = 5;
      for (let i = 1; i < gridLines; i++) {
        const y = (height / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();

      // 提取上传和下载数据
      const upValues = normalizedData.map((d) => d.up);
      const downValues = normalizedData.map((d) => d.down);

      // 先绘制下载（背景层）
      drawBezierLine(
        ctx,
        downValues,
        width,
        height,
        colors.down,
        GRAPH_CONFIG.lineWidth.down,
        true,
        GRAPH_CONFIG.alpha.downGradient,
      );

      // 再绘制上传（前景层）
      drawBezierLine(
        ctx,
        upValues,
        width,
        height,
        colors.up,
        GRAPH_CONFIG.lineWidth.up,
        true,
        GRAPH_CONFIG.alpha.upGradient,
      );
    }, [normalizeData, colors, drawBezierLine]);

    // 动画循环
    useEffect(() => {
      const animate = (currentTime: number) => {
        if (
          currentTime - lastDrawTimeRef.current >=
          1000 / GRAPH_CONFIG.frameRate
        ) {
          drawGraph();
          lastDrawTimeRef.current = currentTime;
        }
        animationRef.current = requestAnimationFrame(animate);
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [drawGraph]);

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

    // 添加数据点方法（保持兼容性）
    const appendData = useCallback((data: ITrafficItem) => {
      // 现在数据由全局Hook管理，这个方法保持兼容性
      console.log(
        "[EnhancedCanvasTrafficGraph] appendData called (using global data):",
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
          width={400}
          height={130}
        />

        {/* 时间范围和图例覆盖层 */}
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            p: 1,
          }}
        >
          {/* 时间范围按钮 */}
          <Box
            component="div"
            onClick={handleTimeRangeClick}
            sx={{
              position: "absolute",
              top: 4,
              left: 6,
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
              top: 4,
              right: 6,
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
              bottom: 4,
              right: 6,
              fontSize: "10px",
              color: "text.disabled",
              opacity: 0.7,
            }}
          >
            {chartStyle === "bezier" ? "Smooth" : "Linear"}
          </Box>

          {/* 数据状态指示器（调试模式） */}
          {import.meta.env.DEV && (
            <Box
              sx={{
                position: "absolute",
                bottom: 4,
                left: 6,
                fontSize: "9px",
                color: "text.disabled",
                opacity: 0.5,
              }}
            >
              Points: {displayDataRef.current.length} | Fresh:{" "}
              {isDataFresh ? "✓" : "✗"} | Compressed:{" "}
              {samplerStats.compressedBufferSize}
            </Box>
          )}
        </Box>
      </Box>
    );
  }),
);

EnhancedCanvasTrafficGraph.displayName = "EnhancedCanvasTrafficGraph";
