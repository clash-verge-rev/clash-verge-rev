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

// 创建一个明确的类型
type DataPoint = ITrafficItem & { name: string; timestamp: number };

// 控制帧率的工具函数
const FPS_LIMIT = 1; // 限制为1fps，因为数据每秒才更新一次
const FRAME_MIN_TIME = 1000 / FPS_LIMIT; // 每帧最小时间间隔，即1000ms

// 全局存储流量数据历史记录
declare global {
  interface Window {
    trafficHistoryData?: DataPoint[];
    trafficHistoryStyle?: "line" | "area";
    trafficHistoryTimeRange?: TimeRange;
  }
}

// 初始化全局存储
if (typeof window !== "undefined" && !window.trafficHistoryData) {
  window.trafficHistoryData = [];
  window.trafficHistoryStyle = "area";
  window.trafficHistoryTimeRange = 10;
}

/**
 * 增强型流量图表组件
 * 基于 Recharts 实现，支持线图和面积图两种模式
 */
export const EnhancedTrafficGraph = memo(forwardRef<EnhancedTrafficGraphRef>(
  (props, ref) => {
    const theme = useTheme();
    const { t } = useTranslation();

    // 从全局变量恢复状态
    const [timeRange, setTimeRange] = useState<TimeRange>(
      window.trafficHistoryTimeRange || 10
    );
    const [chartStyle, setChartStyle] = useState<"line" | "area">(
      window.trafficHistoryStyle || "area"
    );
    
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
        const newRange = prevRange === 1 ? 5 : prevRange === 5 ? 10 : 1;
        window.trafficHistoryTimeRange = newRange; // 保存到全局
        return newRange;
      });
    }, []);

    // 初始化数据缓冲区
    useEffect(() => {
      let initialBuffer: DataPoint[] = [];
      
      // 如果全局有保存的数据，优先使用
      if (window.trafficHistoryData && window.trafficHistoryData.length > 0) {
        initialBuffer = [...window.trafficHistoryData];
        
        // 确保数据长度符合要求
        if (initialBuffer.length > MAX_BUFFER_SIZE) {
          initialBuffer = initialBuffer.slice(-MAX_BUFFER_SIZE);
        } else if (initialBuffer.length < MAX_BUFFER_SIZE) {
          // 如果历史数据不足，则在前面补充空数据
          const now = Date.now();
          const oldestTimestamp = initialBuffer.length > 0 
            ? initialBuffer[0].timestamp 
            : now - 10 * 60 * 1000;
          
          const additionalPoints = MAX_BUFFER_SIZE - initialBuffer.length;
          const timeInterval = initialBuffer.length > 0
            ? (initialBuffer[0].timestamp - (now - 10 * 60 * 1000)) / additionalPoints
            : (10 * 60 * 1000) / MAX_BUFFER_SIZE;
          
          const emptyPrefix: DataPoint[] = Array.from(
            { length: additionalPoints },
            (_, index) => {
              const pointTime = oldestTimestamp - (additionalPoints - index) * timeInterval;
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
          
          initialBuffer = [...emptyPrefix, ...initialBuffer];
        }
      } else {
        // 没有历史数据时，创建空的初始缓冲区
        const now = Date.now();
        const tenMinutesAgo = now - 10 * 60 * 1000;

        initialBuffer = Array.from(
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
      }

      dataBufferRef.current = initialBuffer;
      window.trafficHistoryData = initialBuffer; // 保存到全局
      
      // 更新显示数据
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      setDisplayData(initialBuffer.slice(-pointsToShow));
      
      // 清理函数，取消任何未完成的动画帧
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [MAX_BUFFER_SIZE, getMaxPointsByTimeRange, timeRange]);

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

      // 更新ref，但保持原数组大小
      const newBuffer = [...dataBufferRef.current.slice(1), newPoint];
      dataBufferRef.current = newBuffer;
      
      // 保存到全局变量
      window.trafficHistoryData = newBuffer;
      
      // 使用节流更新显示数据
      throttledUpdateData();
    }, [throttledUpdateData]);

    // 切换图表样式
    const toggleStyle = useCallback(() => {
      setChartStyle((prev) => {
        const newStyle = prev === "line" ? "area" : "line";
        window.trafficHistoryStyle = newStyle; // 保存到全局
        return newStyle;
      });
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
    const formatTooltip = useCallback((value: number, name: string, props: any) => {
      const [num, unit] = parseTraffic(value);
      // 使用props.dataKey判断是上传还是下载
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
      // 只显示小时和分钟
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
      margin: { top: 10, right: 20, left: 0, bottom: 0 },
    }), [displayData]);

    // 共享的线条/区域配置
    const commonLineProps = useMemo(() => ({
      dot: false,
      strokeWidth: 2,
      connectNulls: false,
      activeDot: { r: 4, strokeWidth: 1 },
      isAnimationActive: false, // 禁用动画以减少CPU使用
    }), []);

    // 曲线类型 - 使用线性曲线避免错位
    const curveType = "monotone";

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
          {chartStyle === "line" ? (
            <LineChart {...chartConfig}>
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
                width={40}
                domain={[0, "auto"]}
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
              
              {/* 可点击的时间范围标签 */}
              <text
                x="1%"
                y="6%"
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
            </LineChart>
          ) : (
            <AreaChart {...chartConfig}>
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
              
              {/* 可点击的时间范围标签 */}
              <text
                x="1%"
                y="6%"
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
            </AreaChart>
          )}
        </ResponsiveContainer>
      </Box>
    );
  },
));

// 添加显示名称以便调试
EnhancedTrafficGraph.displayName = "EnhancedTrafficGraph";
