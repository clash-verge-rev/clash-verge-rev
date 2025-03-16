import {
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactElement,
  useRef,
  memo,
} from "react";
import { Box, useTheme } from "@mui/material";
import parseTraffic from "@/utils/parse-traffic";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

// 流量数据项接口
export interface ITrafficItem {
  up: number;
  down: number;
  timestamp?: number;
}

// 组件对外暴露的方法
export interface EnhancedTrafficGraphRef {
  appendData: (data: ITrafficItem) => void;
  toggleStyle: () => void;
}

// 时间范围类型
type TimeRange = 1 | 5 | 10; // 分钟

// 创建一个明确的类型
type DataPoint = ITrafficItem & { name: string; timestamp: number };

// 控制帧率的工具函数
const FPS_LIMIT = 30; // 限制最高30fps
const FRAME_MIN_TIME = 1000 / FPS_LIMIT; // 每帧最小时间间隔

/**
 * 增强型流量图表组件
 * 基于 Recharts 实现，支持线图和面积图两种模式
 */
export const EnhancedTrafficGraph = memo(forwardRef<EnhancedTrafficGraphRef>(
  (props, ref) => {
    const theme = useTheme();
    const { t } = useTranslation();

    // 时间范围状态(默认10分钟)
    const [timeRange, setTimeRange] = useState<TimeRange>(10);
    
    // 使用useRef存储数据，避免不必要的重渲染
    const dataBufferRef = useRef<DataPoint[]>([]);
    // 只为渲染目的的状态
    const [displayData, setDisplayData] = useState<DataPoint[]>([]);
    
    // 帧率控制
    const lastUpdateTimeRef = useRef<number>(0);
    const pendingUpdateRef = useRef<boolean>(false);
    const rafIdRef = useRef<number | null>(null);

    // 根据时间范围计算保留的数据点数量
    const getMaxPointsByTimeRange = useCallback(
      (minutes: TimeRange): number => {
        // 使用更低的采样率来减少点的数量，每2秒一个点而不是每秒一个点
        return minutes * 30; // 每分钟30个点(每2秒1个点)
      },
      [],
    );

    // 最大数据点数量 - 基于选择的时间范围
    const MAX_BUFFER_SIZE = useMemo(
      () => getMaxPointsByTimeRange(10),
      [getMaxPointsByTimeRange],
    );

    // 图表样式：line 或 area
    const [chartStyle, setChartStyle] = useState<"line" | "area">("area");

    // 颜色配置
    const colors = useMemo(
      () => ({
        up: theme.palette.secondary.main,
        down: theme.palette.primary.main,
        grid: theme.palette.divider,
        tooltip: theme.palette.background.paper,
        text: theme.palette.text.primary,
      }),
      [theme],
    );

    // 切换时间范围
    const handleTimeRangeClick = useCallback(() => {
      setTimeRange((prevRange) => {
        // 在1、5、10分钟之间循环切换
        if (prevRange === 1) return 5;
        if (prevRange === 5) return 10;
        return 1;
      });
    }, []);

    // 初始化空数据缓冲区
    useEffect(() => {
      // 生成10分钟的初始数据点
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;

      // 创建初始缓冲区，降低点的密度
      const initialBuffer: DataPoint[] = Array.from(
        { length: MAX_BUFFER_SIZE },
        (_, index) => {
          // 计算每个点的时间
          const pointTime =
            tenMinutesAgo + index * ((10 * 60 * 1000) / MAX_BUFFER_SIZE);
          const date = new Date(pointTime);

          return {
            up: 0,
            down: 0,
            timestamp: pointTime,
            name: date.toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          };
        },
      );

      dataBufferRef.current = initialBuffer;
      setDisplayData(initialBuffer);
      
      // 清理函数，取消任何未完成的动画帧
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [MAX_BUFFER_SIZE]);

    // 处理数据更新并控制帧率的函数
    const updateDisplayData = useCallback(() => {
      if (pendingUpdateRef.current) {
        pendingUpdateRef.current = false;
        
        // 根据当前时间范围计算需要显示的点数
        const pointsToShow = getMaxPointsByTimeRange(timeRange);
        // 从缓冲区中获取最新的数据点
        const newDisplayData = dataBufferRef.current.slice(-pointsToShow);
        setDisplayData(newDisplayData);
      }
      
      rafIdRef.current = null;
    }, [timeRange, getMaxPointsByTimeRange]);
    
    // 节流更新函数
    const throttledUpdateData = useCallback(() => {
      pendingUpdateRef.current = true;
      
      const now = performance.now();
      const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
      
      if (rafIdRef.current === null) {
        if (timeSinceLastUpdate >= FRAME_MIN_TIME) {
          // 如果距离上次更新已经超过最小帧时间，立即更新
          lastUpdateTimeRef.current = now;
          rafIdRef.current = requestAnimationFrame(updateDisplayData);
        } else {
          // 否则，在适当的时间进行更新
          const timeToWait = FRAME_MIN_TIME - timeSinceLastUpdate;
          setTimeout(() => {
            lastUpdateTimeRef.current = performance.now();
            rafIdRef.current = requestAnimationFrame(updateDisplayData);
          }, timeToWait);
        }
      }
    }, [updateDisplayData]);

    // 监听时间范围变化，更新显示数据
    useEffect(() => {
      throttledUpdateData();
    }, [timeRange, throttledUpdateData]);

    // 添加数据点方法
    const appendData = useCallback((data: ITrafficItem) => {
      // 安全处理数据
      const safeData = {
        up: typeof data.up === "number" && !isNaN(data.up) ? data.up : 0,
        down: typeof data.down === "number" && !isNaN(data.down) ? data.down : 0,
      };

      // 使用提供的时间戳或当前时间
      const timestamp = data.timestamp || Date.now();
      const date = new Date(timestamp);

      // 带时间标签的新数据点
      const newPoint: DataPoint = {
        ...safeData,
        name: date.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        timestamp: timestamp,
      };

      // 直接更新ref，不触发重渲染
      dataBufferRef.current = [...dataBufferRef.current.slice(1), newPoint];
      
      // 使用节流更新显示数据
      throttledUpdateData();
    }, [throttledUpdateData]);

    // 切换图表样式
    const toggleStyle = useCallback(() => {
      setChartStyle((prev) => (prev === "line" ? "area" : "line"));
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

    // 格式化工具提示内容
    const formatTooltip = useCallback((value: number) => {
      const [num, unit] = parseTraffic(value);
      return [`${num} ${unit}/s`, ""];
    }, []);

    // Y轴刻度格式化
    const formatYAxis = useCallback((value: number) => {
      const [num, unit] = parseTraffic(value);
      return `${num}${unit}`;
    }, []);

    // 格式化X轴标签
    const formatXLabel = useCallback((value: string) => {
      if (!value) return "";
      // 只显示小时和分钟
      const parts = value.split(":");
      return `${parts[0]}:${parts[1]}`;
    }, []);

    // 获取当前时间范围文本
    const getTimeRangeText = useCallback(() => {
      return t("{{time}} Minutes", { time: timeRange });
    }, [timeRange, t]);

    // 渲染图表内的标签
    const renderInnerLabels = useCallback(() => (
      <>
        {/* 上传标签 - 右上角 */}
        <text
          x="98%"
          y="7%"
          textAnchor="end"
          fill={colors.up}
          fontSize={12}
          fontWeight="bold"
        >
          {t("Upload")}
        </text>

        {/* 下载标签 - 右上角下方 */}
        <text
          x="98%"
          y="16%"
          textAnchor="end"
          fill={colors.down}
          fontSize={12}
          fontWeight="bold"
        >
          {t("Download")}
        </text>
      </>
    ), [colors.up, colors.down, t]);

    // 共享图表配置
    const commonProps = useMemo(() => ({
      data: displayData,
      margin: { top: 10, right: 20, left: 0, bottom: 0 },
    }), [displayData]);

    // 曲线类型 - 使用平滑曲线
    const curveType = "basis";

    // 共享图表子组件
    const commonChildren = useMemo(() => (
      <>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke={colors.grid}
          opacity={0.3}
        />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: colors.text }}
          tickLine={{ stroke: colors.grid }}
          axisLine={{ stroke: colors.grid }}
          interval="preserveStart"
          tickFormatter={formatXLabel}
          minTickGap={timeRange === 1 ? 40 : 80}
          tickCount={Math.min(6, timeRange * 2)}
          domain={["dataMin", "dataMax"]}
          scale="auto"
        />
        <YAxis
          tickFormatter={formatYAxis}
          tick={{ fontSize: 10, fill: colors.text }}
          tickLine={{ stroke: colors.grid }}
          axisLine={{ stroke: colors.grid }}
          width={40}
          domain={[0, "auto"]}
          padding={{ top: 10, bottom: 0 }}
        />
        <Tooltip
          formatter={formatTooltip}
          labelFormatter={(label) => `${t("Time")}: ${label}`}
          contentStyle={{
            backgroundColor: colors.tooltip,
            borderColor: colors.grid,
            borderRadius: 4,
          }}
          itemStyle={{ color: colors.text }}
          isAnimationActive={false}
        />

        {/* 可点击的时间范围标签 */}
        <g
          className="time-range-selector"
          onClick={handleTimeRangeClick}
          style={{ cursor: "pointer" }}
        >
          <text
            x="1%"
            y="6%"
            textAnchor="start"
            fill={theme.palette.text.secondary}
            fontSize={11}
            fontWeight="bold"
          >
            {getTimeRangeText()}
          </text>
        </g>
      </>
    ), [colors, formatXLabel, formatYAxis, formatTooltip, timeRange, theme.palette.text.secondary, handleTimeRangeClick, getTimeRangeText, t]);

    // 渲染图表 - 线图或面积图
    const renderChart = useCallback(() => {
      // 共享的线条/区域配置
      const commonLineProps = {
        dot: false,
        strokeWidth: 2,
        connectNulls: false,
        activeDot: { r: 4, strokeWidth: 1 },
        isAnimationActive: false, // 禁用动画以减少CPU使用
      };

      return chartStyle === "line" ? (
        <LineChart {...commonProps}>
          {commonChildren}
          <Line
            type="basis"
            {...commonLineProps}
            dataKey="up"
            name={t("Upload")}
            stroke={colors.up}
          />
          <Line
            type="basis"
            {...commonLineProps}
            dataKey="down"
            name={t("Download")}
            stroke={colors.down}
          />
          {renderInnerLabels()}
        </LineChart>
      ) : (
        <AreaChart {...commonProps}>
          {commonChildren}
          <Area
            type="basis"
            {...commonLineProps}
            dataKey="up"
            name={t("Upload")}
            stroke={colors.up}
            fill={colors.up}
            fillOpacity={0.2}
          />
          <Area
            type="basis"
            {...commonLineProps}
            dataKey="down"
            name={t("Download")}
            stroke={colors.down}
            fill={colors.down}
            fillOpacity={0.3}
          />
          {renderInnerLabels()}
        </AreaChart>
      );
    }, [chartStyle, commonProps, commonChildren, renderInnerLabels, colors, t]);

    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          position: "relative",
          bgcolor: "action.hover",
          borderRadius: 1,
          padding: 1,
          cursor: "pointer",
        }}
        onClick={toggleStyle}
      >
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </Box>
    );
  },
));

// 添加显示名称以便调试
EnhancedTrafficGraph.displayName = "EnhancedTrafficGraph";
