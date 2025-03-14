import {
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactElement,
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

/**
 * 增强型流量图表组件
 * 基于 Recharts 实现，支持线图和面积图两种模式
 */
export const EnhancedTrafficGraph = forwardRef<EnhancedTrafficGraphRef>(
  (props, ref) => {
    const theme = useTheme();
    const { t } = useTranslation();

    // 时间范围状态(默认10分钟)
    const [timeRange, setTimeRange] = useState<TimeRange>(10);

    // 根据时间范围计算保留的数据点数量
    const getMaxPointsByTimeRange = useCallback(
      (minutes: TimeRange): number => minutes * 60, // 每分钟60个点(每秒1个点)
      [],
    );

    // 最大数据点数量 - 基于选择的时间范围
    const MAX_BUFFER_SIZE = useMemo(
      () => getMaxPointsByTimeRange(10),
      [getMaxPointsByTimeRange],
    );

    // 图表样式：line 或 area
    const [chartStyle, setChartStyle] = useState<"line" | "area">("area");

    // 创建一个明确的类型
    type DataPoint = ITrafficItem & { name: string; timestamp: number };

    // 完整数据缓冲区 - 保存10分钟的数据
    const [dataBuffer, setDataBuffer] = useState<DataPoint[]>([]);

    // 当前显示的数据点 - 根据选定的时间范围从缓冲区过滤
    const dataPoints = useMemo(() => {
      if (dataBuffer.length === 0) return [];
      // 根据当前时间范围计算需要显示的点数
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      // 从缓冲区中获取最新的数据点
      return dataBuffer.slice(-pointsToShow);
    }, [dataBuffer, timeRange, getMaxPointsByTimeRange]);

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

      // 创建600个点作为初始缓冲区
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

      setDataBuffer(initialBuffer);
    }, [MAX_BUFFER_SIZE]);

    // 添加数据点方法
    const appendData = useCallback((data: ITrafficItem) => {
      // 安全处理数据
      const safeData = {
        up: typeof data.up === "number" && !isNaN(data.up) ? data.up : 0,
        down:
          typeof data.down === "number" && !isNaN(data.down) ? data.down : 0,
      };

      setDataBuffer((prev) => {
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

        // 更新缓冲区，保持最大长度
        return [...prev.slice(1), newPoint];
      });
    }, []);

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
    const formatTooltip = (value: number) => {
      const [num, unit] = parseTraffic(value);
      return [`${num} ${unit}/s`, ""];
    };

    // Y轴刻度格式化
    const formatYAxis = (value: number) => {
      const [num, unit] = parseTraffic(value);
      return `${num}${unit}`;
    };

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
    const renderInnerLabels = () => (
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
    );

    // 共享图表配置
    const commonProps = {
      data: dataPoints,
      margin: { top: 10, right: 20, left: 0, bottom: 0 },
    };

    // 曲线类型 - 使用平滑曲线
    const curveType = "basis";

    // 共享图表子组件
    const commonChildren = (
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
    );

    // 渲染图表 - 线图或面积图
    const renderChart = () => {
      // 共享的线条/区域配置
      const commonLineProps = {
        dot: false,
        strokeWidth: 2,
        connectNulls: false,
        activeDot: { r: 4, strokeWidth: 1 },
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
    };

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
);
