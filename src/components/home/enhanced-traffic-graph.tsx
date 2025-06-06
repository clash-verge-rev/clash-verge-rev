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
import { Line as ChartJsLine } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Scale,
  Tick,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
);

// 流量数据项接口
export interface ITrafficItem {
  up: number;
  down: number;
  timestamp?: number;
}

// 对外暴露的接口
export interface EnhancedTrafficGraphRef {
  appendData: (data: ITrafficItem) => void;
  toggleStyle: () => void;
}

type TimeRange = 1 | 5 | 10; // 分钟

// 数据点类型
type DataPoint = ITrafficItem & { name: string; timestamp: number };

/**
 * 增强型流量图表组件
 */
export const EnhancedTrafficGraph = memo(
  forwardRef<EnhancedTrafficGraphRef>((props, ref) => {
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
      (minutes: TimeRange): number => minutes * 60,
      [],
    );

    // 最大数据点数量
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
        tooltipBg: theme.palette.background.paper,
        text: theme.palette.text.primary,
        tooltipBorder: theme.palette.divider,
      }),
      [theme],
    );

    // 切换时间范围
    const handleTimeRangeClick = useCallback(
      (event: React.MouseEvent<SVGTextElement>) => {
        event.stopPropagation();
        setTimeRange((prevRange) => {
          return prevRange === 1 ? 5 : prevRange === 5 ? 10 : 1;
        });
      },
      [],
    );

    // 点击图表主体或图例时切换样式
    const handleToggleStyleClick = useCallback(
      (event: React.MouseEvent<SVGTextElement | HTMLDivElement>) => {
        event.stopPropagation();
        setChartStyle((prev) => (prev === "line" ? "area" : "line"));
      },
      [],
    );

    // 初始化数据缓冲区
    useEffect(() => {
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;

      const initialBuffer = Array.from(
        { length: MAX_BUFFER_SIZE },
        (_, index) => {
          const pointTime =
            tenMinutesAgo + index * ((10 * 60 * 1000) / MAX_BUFFER_SIZE);
          const date = new Date(pointTime);
          let nameValue: string;
          try {
            if (isNaN(date.getTime())) {
              console.warn(
                `Initial data generation: Invalid date for timestamp ${pointTime}`,
              );
              nameValue = "??:??:??";
            } else {
              nameValue = date.toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
            }
          } catch (e) {
            console.error(
              "Error in toLocaleTimeString during initial data gen:",
              e,
              "Date:",
              date,
              "Timestamp:",
              pointTime,
            );
            nameValue = "Err:Time";
          }

          return {
            up: 0,
            down: 0,
            timestamp: pointTime,
            name: nameValue,
          };
        },
      );

      dataBufferRef.current = initialBuffer;

      // 更新显示数据
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      setDisplayData(initialBuffer.slice(-pointsToShow));
    }, [MAX_BUFFER_SIZE, getMaxPointsByTimeRange]);
    // 添加数据点方法
    const appendData = useCallback(
      (data: ITrafficItem) => {
        const safeData = {
          up: typeof data.up === "number" && !isNaN(data.up) ? data.up : 0,
          down:
            typeof data.down === "number" && !isNaN(data.down) ? data.down : 0,
        };

        const timestamp = data.timestamp || Date.now();
        const date = new Date(timestamp);

        let nameValue: string;
        try {
          if (isNaN(date.getTime())) {
            console.warn(`appendData: Invalid date for timestamp ${timestamp}`);
            nameValue = "??:??:??";
          } else {
            nameValue = date.toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
          }
        } catch (e) {
          console.error(
            "Error in toLocaleTimeString in appendData:",
            e,
            "Date:",
            date,
            "Timestamp:",
            timestamp,
          );
          nameValue = "Err:Time";
        }
        // 带时间标签的新数据点
        const newPoint: DataPoint = {
          ...safeData,
          name: nameValue,
          timestamp: timestamp,
        };

        const newBuffer = [...dataBufferRef.current.slice(1), newPoint];
        dataBufferRef.current = newBuffer;

        const pointsToShow = getMaxPointsByTimeRange(timeRange);
        setDisplayData(newBuffer.slice(-pointsToShow));
      },
      [timeRange, getMaxPointsByTimeRange],
    );

    // 监听时间范围变化
    useEffect(() => {
      const pointsToShow = getMaxPointsByTimeRange(timeRange);
      if (dataBufferRef.current.length > 0) {
        setDisplayData(dataBufferRef.current.slice(-pointsToShow));
      }
    }, [timeRange, getMaxPointsByTimeRange]);

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

    const formatYAxis = useCallback((value: number | string): string => {
      if (typeof value !== "number") return String(value);
      const [num, unit] = parseTraffic(value);
      return `${num}${unit}`;
    }, []);

    const formatXLabel = useCallback(
      (tickValue: string | number, index: number, ticks: any[]) => {
        const dataPoint = displayData[index as number];
        if (dataPoint && dataPoint.name) {
          const parts = dataPoint.name.split(":");
          return `${parts[0]}:${parts[1]}`;
        }
        if (typeof tickValue === "string") {
          const parts = tickValue.split(":");
          if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
          return tickValue;
        }
        return "";
      },
      [displayData],
    );

    // 获取当前时间范围文本
    const getTimeRangeText = useCallback(() => {
      return t("{{time}} Minutes", { time: timeRange });
    }, [timeRange, t]);

    const chartData = useMemo(() => {
      const labels = displayData.map((d) => d.name);
      return {
        labels,
        datasets: [
          {
            label: t("Upload"),
            data: displayData.map((d) => d.up),
            borderColor: colors.up,
            backgroundColor: chartStyle === "area" ? colors.up : colors.up,
            fill: chartStyle === "area",
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
          {
            label: t("Download"),
            data: displayData.map((d) => d.down),
            borderColor: colors.down,
            backgroundColor: chartStyle === "area" ? colors.down : colors.down,
            fill: chartStyle === "area",
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
        ],
      };
    }, [displayData, colors.up, colors.down, t, chartStyle]);

    const chartOptions = useMemo(
      () => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false as false,
        scales: {
          x: {
            display: true,
            type: "category" as const,
            labels: displayData.map((d) => d.name),
            ticks: {
              display: true,
              color: colors.text,
              font: { size: 10 },
              callback: function (
                this: Scale,
                tickValue: string | number,
                index: number,
                ticks: Tick[],
              ): string | undefined {
                let labelToFormat: string | undefined = undefined;

                const currentDisplayTick = ticks[index];
                if (
                  currentDisplayTick &&
                  typeof currentDisplayTick.label === "string"
                ) {
                  labelToFormat = currentDisplayTick.label;
                } else {
                  const sourceLabels = displayData.map((d) => d.name);
                  if (
                    typeof tickValue === "number" &&
                    tickValue >= 0 &&
                    tickValue < sourceLabels.length
                  ) {
                    labelToFormat = sourceLabels[tickValue];
                  } else if (typeof tickValue === "string") {
                    labelToFormat = tickValue;
                  }
                }

                if (typeof labelToFormat !== "string") {
                  return undefined;
                }

                const parts: string[] = labelToFormat.split(":");
                return parts.length >= 2
                  ? `${parts[0]}:${parts[1]}`
                  : labelToFormat;
              },
              autoSkip: true,
              maxTicksLimit: Math.max(
                5,
                Math.floor(displayData.length / (timeRange * 2)),
              ),
              minRotation: 0,
              maxRotation: 0,
            },
            grid: {
              display: true,
              drawOnChartArea: false,
              drawTicks: true,
              tickLength: 2,
              color: colors.text,
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: colors.text,
              font: { size: 10 },
              callback: formatYAxis,
            },
            grid: {
              display: true,
              drawTicks: true,
              tickLength: 3,
              color: colors.grid,
            },
          },
        },
        plugins: {
          tooltip: {
            enabled: true,
            mode: "index" as const,
            intersect: false,
            backgroundColor: colors.tooltipBg,
            titleColor: colors.text,
            bodyColor: colors.text,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            cornerRadius: 4,
            padding: 8,
            callbacks: {
              title: (tooltipItems: any[]) => {
                return `${t("Time")}: ${tooltipItems[0].label}`;
              },
              label: (context: any): string => {
                const label = context.dataset.label || "";
                const value = context.parsed.y;
                const [num, unit] = parseTraffic(value);
                return `${label}: ${num} ${unit}/s`;
              },
            },
          },
          legend: {
            display: false,
          },
        },
        layout: {
          padding: {
            top: 16,
            right: 7,
            left: 3,
          },
        },
      }),
      [colors, t, formatYAxis, timeRange, displayData],
    );

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
        onClick={handleToggleStyleClick}
      >
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
          {displayData.length > 0 && (
            <ChartJsLine data={chartData} options={chartOptions} />
          )}

          <svg
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          >
            <text
              x="3.5%"
              y="10%"
              textAnchor="start"
              fill={theme.palette.text.secondary}
              fontSize={11}
              fontWeight="bold"
              onClick={handleTimeRangeClick}
              style={{ cursor: "pointer", pointerEvents: "all" }}
            >
              {getTimeRangeText()}
            </text>

            <text
              x="99%"
              y="10%"
              textAnchor="end"
              fill={colors.up}
              fontSize={12}
              fontWeight="bold"
              onClick={handleToggleStyleClick}
              style={{ cursor: "pointer", pointerEvents: "all" }}
            >
              {t("Upload")}
            </text>

            <text
              x="99%"
              y="19%"
              textAnchor="end"
              fill={colors.down}
              fontSize={12}
              fontWeight="bold"
              onClick={handleToggleStyleClick}
              style={{ cursor: "pointer", pointerEvents: "all" }}
            >
              {t("Download")}
            </text>
          </svg>
        </div>
      </Box>
    );
  }),
);

EnhancedTrafficGraph.displayName = "EnhancedTrafficGraph";
