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

// 数据点类型
type DataPoint = ITrafficItem & { name: string; timestamp: number };

/**
 * 增强型流量图表组件
 */
export const EnhancedTrafficGraph = memo(forwardRef<EnhancedTrafficGraphRef>(
  (props, ref) => {
    const theme = useTheme();
    const { t } = useTranslation();

    // 基础状态
    const [timeRange, setTimeRange] = useState<TimeRange>(10);
    const [chartStyle, setChartStyle] = useState<"line" | "area">("area");
    const [displayData, setDisplayData] = useState<DataPoint[]>([]);
    
    // 数据缓冲区
    const dataBufferRef = useRef<DataPoint[]>([]);

    // 根据时间范围计算保留的数据点数量
    const getMaxPointsByTimeRange = useCallback(
      (minutes: TimeRange): number => minutes * 30,
      []
    );

    // 最大数据点数量
    const MAX_BUFFER_SIZE = useMemo(
      () => getMaxPointsByTimeRange(10),
      [getMaxPointsByTimeRange]
    );

    // 颜色配置
    const colors = useMemo(
      () => ({
        up: theme.palette.secondary.main,
        down: theme.palette.primary.main,
        grid: theme.palette.divider,
        tooltip: theme.palette.background.paper,
        text: theme.palette.text.primary,
      }),
      [theme]
    );

    // 切换时间范围
    const handleTimeRangeClick = useCallback(() => {
      setTimeRange((prevRange) => {
        // 在1、5、10分钟之间循环切换
        return prevRange === 1 ? 5 : prevRange === 5 ? 10 : 1;
      });
    }, []);

    // 初始化数据缓冲区
    useEffect(() => {
      // 创建初始空数据
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;

      const initialBuffer = Array.from(
        { length: MAX_BUFFER_SIZE },
        (_, index) => {
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
        }
      );

      dataBufferRef.current = initialBuffer;
      
      // 更新显示数据
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      setDisplayData(initialBuffer.slice(-pointsToShow));
    }, [MAX_BUFFER_SIZE, getMaxPointsByTimeRange]);

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

      // 更新缓冲区，保持原数组大小
      const newBuffer = [...dataBufferRef.current.slice(1), newPoint];
      dataBufferRef.current = newBuffer;
      
      // 更新显示数据
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      setDisplayData(newBuffer.slice(-pointsToShow));
    }, [timeRange, getMaxPointsByTimeRange]);

    // 监听时间范围变化，更新显示数据
    useEffect(() => {
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      setDisplayData(dataBufferRef.current.slice(-pointsToShow));
    }, [timeRange, getMaxPointsByTimeRange]);

    // 切换图表样式
    const toggleStyle = useCallback(() => {
      setChartStyle((prev) => prev === "line" ? "area" : "line");
    }, []);

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        appendData,
        toggleStyle,
      }),
      [appendData, toggleStyle]
    );

    // 格式化工具提示内容
    const formatTooltip = useCallback((value: number, name: string, props: any) => {
      const [num, unit] = parseTraffic(value);
      return [`${num} ${unit}/s`, props?.dataKey === "up" ? t("Upload") : t("Download")];
    }, [t]);

    // Y轴刻度格式化
    const formatYAxis = useCallback((value: number) => {
      const [num, unit] = parseTraffic(value);
      return `${num}${unit}`;
    }, []);

    // 格式化X轴标签
    const formatXLabel = useCallback((value: string) => {
      if (!value) return "";
      const parts = value.split(":");
      return `${parts[0]}:${parts[1]}`;
    }, []);

    // 获取当前时间范围文本
    const getTimeRangeText = useCallback(() => {
      return t("{{time}} Minutes", { time: timeRange });
    }, [timeRange, t]);

    // 共享图表配置
    const chartConfig = useMemo(() => ({
      data: displayData,
      margin: { top: 20, right: 10, left: 0, bottom: -10 },
    }), [displayData]);

    // 共享的线条/区域配置
    const commonLineProps = useMemo(() => ({
      dot: false,
      strokeWidth: 2,
      connectNulls: false,
      activeDot: { r: 4, strokeWidth: 1 },
      isAnimationActive: false, // 禁用动画以减少CPU使用
    }), []);

    // 曲线类型
    const curveType = "monotone";

    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          position: "relative",
          bgcolor: "action.hover",
          borderRadius: 1,
          cursor: "pointer",
        }}
        onClick={toggleStyle}
      >
        <ResponsiveContainer width="100%" height="100%">
          {/* 根据chartStyle动态选择图表类型 */}
          {(() => {
            // 创建共享的图表组件
            const commonChartComponents = (
              <>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} opacity={0.3} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: colors.text }}
                  tickLine={{ stroke: colors.grid }}
                  axisLine={{ stroke: colors.grid }}
                  interval="preserveStart"
                  tickFormatter={formatXLabel}
                  minTickGap={30}
                />
                <YAxis
                  tickFormatter={formatYAxis}
                  tick={{ fontSize: 10, fill: colors.text }}
                  tickLine={{ stroke: colors.grid }}
                  axisLine={{ stroke: colors.grid }}
                  width={44}
                  domain={[0, "auto"]}
                  padding={{ top: 8, bottom: 0 }}
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
                <text
                  x="1%"
                  y="11%"
                  textAnchor="start"
                  fill={theme.palette.text.secondary}
                  fontSize={11}
                  fontWeight="bold"
                  onClick={handleTimeRangeClick}
                  style={{ cursor: "pointer" }}
                >
                  {getTimeRangeText()}
                </text>
                
                {/* 上传标签 - 右上角 */}
                <text
                  x="99%"
                  y="11%"
                  textAnchor="end"
                  fill={colors.up}
                  fontSize={12}
                  fontWeight="bold"
                  onClick={toggleStyle}
                  style={{ cursor: "pointer" }}
                >
                  {t("Upload")}
                </text>

                {/* 下载标签 - 右上角下方 */}
                <text
                  x="99%"
                  y="19%"
                  textAnchor="end"
                  fill={colors.down}
                  fontSize={12}
                  fontWeight="bold"
                  onClick={toggleStyle}
                  style={{ cursor: "pointer" }}
                >
                  {t("Download")}
                </text>
              </>
            );

            // 根据chartStyle返回相应的图表类型
            if (chartStyle === "line") {
              return (
                <LineChart {...chartConfig}>
                  {commonChartComponents}
                  <Line
                    type={curveType}
                    {...commonLineProps}
                    dataKey="up"
                    name={t("Upload")}
                    stroke={colors.up}
                  />
                  <Line
                    type={curveType}
                    {...commonLineProps}
                    dataKey="down"
                    name={t("Download")}
                    stroke={colors.down}
                  />
                </LineChart>
              );
            } else {
              return (
                <AreaChart {...chartConfig}>
                  {commonChartComponents}
                  <Area
                    type={curveType}
                    {...commonLineProps}
                    dataKey="up"
                    name={t("Upload")}
                    stroke={colors.up}
                    fill={colors.up}
                    fillOpacity={0.2}
                  />
                  <Area
                    type={curveType}
                    {...commonLineProps}
                    dataKey="down"
                    name={t("Download")}
                    stroke={colors.down}
                    fill={colors.down}
                    fillOpacity={0.3}
                  />
                </AreaChart>
              );
            }
          })()}
        </ResponsiveContainer>
      </Box>
    );
  },
));

// 添加显示名称以便调试
EnhancedTrafficGraph.displayName = "EnhancedTrafficGraph";
