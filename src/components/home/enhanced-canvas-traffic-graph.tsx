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
import { Box, useTheme, Tooltip, Paper, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import parseTraffic from "@/utils/parse-traffic";
import {
  useTrafficGraphDataEnhanced,
  type ITrafficDataPoint,
} from "@/hooks/use-traffic-monitor";

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

// 悬浮提示数据接口
interface TooltipData {
  x: number;
  y: number;
  upSpeed: string;
  downSpeed: string;
  timestamp: string;
  visible: boolean;
  dataIndex: number; // 添加数据索引用于高亮
  highlightY: number; // 高亮Y轴位置
}

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
const PADDING_LEFT = 35; // 增加左边距为Y轴标签留出空间

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

    // 悬浮提示状态
    const [tooltipData, setTooltipData] = useState<TooltipData>({
      x: 0,
      y: 0,
      upSpeed: "",
      downSpeed: "",
      timestamp: "",
      visible: false,
      dataIndex: -1,
      highlightY: 0,
    });

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

    // Y轴坐标计算 - 基于刻度范围的线性映射
    const calculateY = useCallback(
      (value: number, height: number, data: ITrafficDataPoint[]): number => {
        const padding = GRAPH_CONFIG.padding;
        const topY = padding.top + 10; // 与刻度系统保持一致
        const bottomY = height - padding.bottom - 5;

        if (data.length === 0) return bottomY;

        // 获取当前的刻度范围
        const allValues = [
          ...data.map((d) => d.up),
          ...data.map((d) => d.down),
        ];
        const maxValue = Math.max(...allValues);
        const minValue = Math.min(...allValues);

        let topValue, bottomValue;

        if (maxValue === 0) {
          topValue = 1024;
          bottomValue = 0;
        } else {
          const range = maxValue - minValue;
          const padding_percent = range > 0 ? 0.1 : 0.5;

          if (range === 0) {
            bottomValue = 0;
            topValue = maxValue * 1.2;
          } else {
            bottomValue = Math.max(0, minValue - range * padding_percent);
            topValue = maxValue + range * padding_percent;
          }
        }

        // 线性映射到Y坐标
        if (topValue === bottomValue) return bottomY;

        const ratio = (value - bottomValue) / (topValue - bottomValue);
        return bottomY - ratio * (bottomY - topY);
      },
      [],
    );

    // 鼠标悬浮处理 - 计算最近的数据点
    const handleMouseMove = useCallback(
      (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || displayData.length === 0) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const padding = GRAPH_CONFIG.padding;
        const effectiveWidth = rect.width - padding.left - padding.right;

        // 计算最接近的数据点索引
        const relativeMouseX = mouseX - padding.left;
        const ratio = Math.max(0, Math.min(1, relativeMouseX / effectiveWidth));
        const dataIndex = Math.round(ratio * (displayData.length - 1));

        if (dataIndex >= 0 && dataIndex < displayData.length) {
          const dataPoint = displayData[dataIndex];

          // 格式化流量数据
          const [upValue, upUnit] = parseTraffic(dataPoint.up);
          const [downValue, downUnit] = parseTraffic(dataPoint.down);

          // 格式化时间戳
          const timeStr = dataPoint.timestamp
            ? new Date(dataPoint.timestamp).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "未知时间";

          // 计算数据点对应的Y坐标位置（用于高亮）
          const upY = calculateY(dataPoint.up, rect.height, displayData);
          const downY = calculateY(dataPoint.down, rect.height, displayData);
          const highlightY =
            Math.max(dataPoint.up, dataPoint.down) === dataPoint.up
              ? upY
              : downY;

          setTooltipData({
            x: mouseX,
            y: mouseY,
            upSpeed: `${upValue}${upUnit}/s`,
            downSpeed: `${downValue}${downUnit}/s`,
            timestamp: timeStr,
            visible: true,
            dataIndex,
            highlightY,
          });
        }
      },
      [displayData, calculateY],
    );

    // 鼠标离开处理
    const handleMouseLeave = useCallback(() => {
      setTooltipData((prev) => ({ ...prev, visible: false }));
    }, []);

    // 获取智能Y轴刻度（三刻度系统：最小值、中间值、最大值）
    const getYAxisTicks = useCallback(
      (data: ITrafficDataPoint[], height: number) => {
        if (data.length === 0) return [];

        // 找到数据的最大值和最小值
        const allValues = [
          ...data.map((d) => d.up),
          ...data.map((d) => d.down),
        ];
        const maxValue = Math.max(...allValues);
        const minValue = Math.min(...allValues);

        // 格式化流量数值
        const formatTrafficValue = (bytes: number): string => {
          if (bytes === 0) return "0";
          if (bytes < 1024) return `${Math.round(bytes)}B`;
          if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
          return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
        };

        const padding = GRAPH_CONFIG.padding;
        const effectiveHeight = height - padding.top - padding.bottom;

        // 强制显示三个刻度：底部、中间、顶部
        const topY = padding.top + 10; // 避免与顶部时间范围按钮重叠
        const bottomY = height - padding.bottom - 5; // 避免与底部时间轴重叠
        const middleY = (topY + bottomY) / 2;

        // 计算对应的值
        let topValue, middleValue, bottomValue;

        if (maxValue === 0) {
          // 如果没有流量，显示0到一个小值的范围
          topValue = 1024; // 1KB
          middleValue = 512; // 512B
          bottomValue = 0;
        } else {
          // 根据数据范围计算合适的刻度值
          const range = maxValue - minValue;
          const padding_percent = range > 0 ? 0.1 : 0.5; // 如果范围为0，使用更大的边距

          if (range === 0) {
            // 所有值相同的情况
            bottomValue = 0;
            middleValue = maxValue * 0.5;
            topValue = maxValue * 1.2;
          } else {
            // 正常情况
            bottomValue = Math.max(0, minValue - range * padding_percent);
            topValue = maxValue + range * padding_percent;
            middleValue = (bottomValue + topValue) / 2;
          }
        }

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
        ];

        return ticks;
      },
      [],
    );

    // 绘制Y轴刻度线和标签
    const drawYAxis = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        data: ITrafficDataPoint[],
      ) => {
        const padding = GRAPH_CONFIG.padding;
        const ticks = getYAxisTicks(data, height);

        if (ticks.length === 0) return;

        ctx.save();

        ticks.forEach((tick, index) => {
          const isBottomTick = index === 0; // 最底部的刻度
          const isTopTick = index === ticks.length - 1; // 最顶部的刻度

          // 绘制水平刻度线，只绘制关键刻度线
          if (isBottomTick || isTopTick) {
            ctx.strokeStyle = colors.grid;
            ctx.lineWidth = isBottomTick ? 0.8 : 0.4; // 底部刻度线稍粗
            ctx.globalAlpha = isBottomTick ? 0.25 : 0.15;

            ctx.beginPath();
            ctx.moveTo(padding.left, tick.y);
            ctx.lineTo(width - padding.right, tick.y);
            ctx.stroke();
          }

          // 绘制Y轴标签
          ctx.fillStyle = colors.text;
          ctx.font =
            "8px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
          ctx.globalAlpha = 0.9;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";

          // 为标签添加更清晰的背景（仅在必要时）
          if (tick.label !== "0") {
            const labelWidth = ctx.measureText(tick.label).width;
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = colors.background;
            ctx.fillRect(
              padding.left - labelWidth - 8,
              tick.y - 5,
              labelWidth + 4,
              10,
            );
          }

          // 绘制标签文字
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = colors.text;
          ctx.fillText(tick.label, padding.left - 4, tick.y);
        });

        ctx.restore();
      },
      [colors.grid, colors.text, colors.background, getYAxisTicks],
    );

    // 获取时间范围对应的最佳时间显示策略
    const getTimeDisplayStrategy = useCallback(
      (timeRangeMinutes: TimeRange) => {
        switch (timeRangeMinutes) {
          case 1: // 1分钟：更密集的时间标签，显示 MM:SS
            return {
              maxLabels: 6, // 减少到6个，更适合短时间
              formatTime: (timestamp: number) => {
                const date = new Date(timestamp);
                const minutes = date.getMinutes().toString().padStart(2, "0");
                const seconds = date.getSeconds().toString().padStart(2, "0");
                return `${minutes}:${seconds}`; // 显示 MM:SS
              },
              intervalSeconds: 10, // 每10秒一个标签，更合理
              minPixelDistance: 35, // 减少间距，允许更多标签
            };
          case 5: // 5分钟：中等密度，显示 HH:MM
            return {
              maxLabels: 6, // 6个标签比较合适
              formatTime: (timestamp: number) => {
                const date = new Date(timestamp);
                return date.toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                }); // 显示 HH:MM
              },
              intervalSeconds: 30, // 约30秒间隔
              minPixelDistance: 38, // 减少间距，允许更多标签
            };
          case 10: // 10分钟：标准密度，显示 HH:MM
          default:
            return {
              maxLabels: 8, // 保持8个
              formatTime: (timestamp: number) => {
                const date = new Date(timestamp);
                return date.toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                }); // 显示 HH:MM
              },
              intervalSeconds: 60, // 1分钟间隔
              minPixelDistance: 40, // 减少间距，允许更多标签
            };
        }
      },
      [],
    );

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

        const strategy = getTimeDisplayStrategy(timeRange);

        ctx.save();
        ctx.fillStyle = colors.text;
        ctx.font =
          "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
        ctx.globalAlpha = 0.7;

        // 根据数据长度和时间范围智能选择显示间隔
        const targetLabels = Math.min(strategy.maxLabels, data.length);
        const step = Math.max(1, Math.floor(data.length / (targetLabels - 1)));

        // 使用策略中定义的最小像素间距
        const minPixelDistance = strategy.minPixelDistance || 45;
        const actualStep = Math.max(
          step,
          Math.ceil((data.length * minPixelDistance) / effectiveWidth),
        );

        // 收集要显示的时间点
        const timePoints: Array<{ index: number; x: number; label: string }> =
          [];

        // 添加第一个时间点
        if (data.length > 0 && data[0].timestamp) {
          timePoints.push({
            index: 0,
            x: padding.left,
            label: strategy.formatTime(data[0].timestamp),
          });
        }

        // 添加中间的时间点
        for (
          let i = actualStep;
          i < data.length - actualStep;
          i += actualStep
        ) {
          const point = data[i];
          if (!point.timestamp) continue;

          const x = padding.left + (i / (data.length - 1)) * effectiveWidth;
          timePoints.push({
            index: i,
            x,
            label: strategy.formatTime(point.timestamp),
          });
        }

        // 添加最后一个时间点（如果不会与前面的重叠）
        if (data.length > 1 && data[data.length - 1].timestamp) {
          const lastX = width - padding.right;
          const lastPoint = timePoints[timePoints.length - 1];

          // 确保最后一个标签与前一个标签有足够间距
          if (!lastPoint || lastX - lastPoint.x >= minPixelDistance) {
            timePoints.push({
              index: data.length - 1,
              x: lastX,
              label: strategy.formatTime(data[data.length - 1].timestamp),
            });
          }
        }

        // 绘制时间标签
        timePoints.forEach((point, index) => {
          if (index === 0) {
            // 第一个标签左对齐
            ctx.textAlign = "left";
          } else if (index === timePoints.length - 1) {
            // 最后一个标签右对齐
            ctx.textAlign = "right";
          } else {
            // 中间标签居中对齐
            ctx.textAlign = "center";
          }

          ctx.fillText(point.label, point.x, timeAxisY);
        });

        ctx.restore();
      },
      [colors.text, timeRange, getTimeDisplayStrategy],
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
        ctx.globalAlpha = 0.7;

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
        data: ITrafficDataPoint[],
      ) => {
        if (values.length < 2) return;

        const padding = GRAPH_CONFIG.padding;
        const effectiveWidth = width - padding.left - padding.right;

        const points = values.map((value, index) => [
          padding.left + (index / (values.length - 1)) * effectiveWidth,
          calculateY(value, height, data),
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

      // 绘制Y轴刻度线（背景层）
      drawYAxis(ctx, width, height, displayData);

      // 绘制网格
      drawGrid(ctx, width, height);

      // 绘制时间轴
      drawTimeAxis(ctx, width, height, displayData);

      // 提取流量数据
      const upValues = displayData.map((d) => d.up);
      const downValues = displayData.map((d) => d.down);

      // 绘制下载线（背景层）
      drawTrafficLine(
        ctx,
        downValues,
        width,
        height,
        colors.down,
        true,
        displayData,
      );

      // 绘制上传线（前景层）
      drawTrafficLine(
        ctx,
        upValues,
        width,
        height,
        colors.up,
        true,
        displayData,
      );

      // 绘制悬浮高亮线
      if (tooltipData.visible && tooltipData.dataIndex >= 0) {
        const padding = GRAPH_CONFIG.padding;
        const effectiveWidth = width - padding.left - padding.right;
        const dataX =
          padding.left +
          (tooltipData.dataIndex / (displayData.length - 1)) * effectiveWidth;

        ctx.save();
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4, 4]); // 虚线效果

        // 绘制垂直指示线
        ctx.beginPath();
        ctx.moveTo(dataX, padding.top);
        ctx.lineTo(dataX, height - padding.bottom);
        ctx.stroke();

        // 绘制水平指示线（高亮Y轴位置）
        ctx.beginPath();
        ctx.moveTo(padding.left, tooltipData.highlightY);
        ctx.lineTo(width - padding.right, tooltipData.highlightY);
        ctx.stroke();

        ctx.restore();
      }

      isInitializedRef.current = true;
    }, [
      displayData,
      colors,
      drawYAxis,
      drawGrid,
      drawTimeAxis,
      drawTrafficLine,
      tooltipData,
    ]);

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
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
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
              left: 40, // 向右移动，避免与Y轴最大值标签重叠
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

          {/* 悬浮提示框 */}
          {tooltipData.visible && (
            <Box
              sx={{
                position: "absolute",
                left: tooltipData.x + 8,
                top: tooltipData.y - 8,
                bgcolor: theme.palette.background.paper,
                border: 1,
                borderColor: "divider",
                borderRadius: 0.5,
                px: 1,
                py: 0.5,
                fontSize: "10px",
                lineHeight: 1.2,
                zIndex: 1000,
                pointerEvents: "none",
                transform:
                  tooltipData.x > 200 ? "translateX(-100%)" : "translateX(0)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                backdropFilter: "none",
                opacity: 1,
              }}
            >
              <Box color="text.secondary" mb={0.2}>
                {tooltipData.timestamp}
              </Box>
              <Box color="secondary.main" fontWeight="500">
                ↑ {tooltipData.upSpeed}
              </Box>
              <Box color="primary.main" fontWeight="500">
                ↓ {tooltipData.downSpeed}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    );
  }),
);

EnhancedCanvasTrafficGraph.displayName = "EnhancedCanvasTrafficGraph";
