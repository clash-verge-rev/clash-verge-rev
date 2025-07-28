import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  MemoryRounded,
  AccessTimeRounded,
} from "@mui/icons-material";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { TrafficGraph, type TrafficRef } from "./traffic-graph";
import { useVisibility } from "@/hooks/use-visibility";
import parseTraffic from "@/utils/parse-traffic";
import { useTranslation } from "react-i18next";
import { isDebugEnabled, gc, startTrafficService } from "@/services/cmds";
import { useTrafficDataEnhanced } from "@/hooks/use-traffic-monitor-enhanced";
import { LightweightTrafficErrorBoundary } from "@/components/common/traffic-error-boundary";
import useSWR from "swr";

interface MemoryUsage {
  inuse: number;
  oslimit?: number;
}

// 格式化时间为 HH:MM:SS 格式
const formatTime = (date: Date): string => {
  return date.toTimeString().slice(0, 8);
};

// 格式化运行时间
const formatUptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
};

// setup the traffic
export const LayoutTraffic = () => {
  const { data: isDebug } = useSWR(
    "clash-verge-rev-internal://isDebugEnabled",
    () => isDebugEnabled(),
    {
      fallbackData: false,
    },
  );

  if (isDebug) {
    console.debug("[Traffic][LayoutTraffic] 组件正在渲染");
  }
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();
  const [currentTime, setCurrentTime] = useState(formatTime(new Date()));
  const [uptime, setUptime] = useState("00:00:00");
  const startTime = useRef<number>(Date.now() / 1000);

  // 实时更新时间和运行计时
  useEffect(() => {
    const timer = setInterval(() => {
      // 更新当前时间
      setCurrentTime(formatTime(new Date()));

      // 计算并更新运行时间
      const currentTime = Date.now() / 1000;
      const elapsedSeconds = Math.floor(currentTime - startTime.current);
      setUptime(formatUptime(elapsedSeconds));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const pageVisible = useVisibility();

  // 使用增强版的统一流量数据Hook
  const { traffic, memory, isLoading, isDataFresh, hasValidData } =
    useTrafficDataEnhanced();

  // 启动流量服务
  useEffect(() => {
    console.log(
      "[Traffic][LayoutTraffic] useEffect 触发，clashInfo:",
      clashInfo,
      "pageVisible:",
      pageVisible,
    );

    // 简化条件，只要组件挂载就尝试启动服务
    console.log("[Traffic][LayoutTraffic] 开始启动流量服务");
    startTrafficService().catch((error) => {
      console.error("[Traffic][LayoutTraffic] 启动流量服务失败:", error);
    });
  }, []); // 移除依赖，只在组件挂载时启动一次

  // 监听数据变化，为图表添加数据点
  useEffect(() => {
    if (traffic?.raw && trafficRef.current) {
      trafficRef.current.appendData({
        up: traffic.raw.up_rate || 0,
        down: traffic.raw.down_rate || 0,
      });
    }
  }, [traffic]);

  // 显示内存使用情况的设置
  const displayMemory = verge?.enable_memory_usage ?? true;

  // 显示运行时间
  const displayRuntime = verge?.enable_runtime_display ?? true;

  // 显示系统时间
  const displaysystemtime = verge?.enable_system_time ?? true;

  // 使用格式化的数据，避免重复解析
  const upSpeed = traffic?.formatted?.up_rate || "0B";
  const downSpeed = traffic?.formatted?.down_rate || "0B";
  const memoryUsage = memory?.formatted?.inuse || "0B";

  // 提取数值和单位
  const [up, upUnit] = upSpeed.includes("B")
    ? upSpeed.split(/(?=[KMGT]?B$)/)
    : [upSpeed, ""];
  const [down, downUnit] = downSpeed.includes("B")
    ? downSpeed.split(/(?=[KMGT]?B$)/)
    : [downSpeed, ""];
  const [inuse, inuseUnit] = memoryUsage.includes("B")
    ? memoryUsage.split(/(?=[KMGT]?B$)/)
    : [memoryUsage, ""];

  const boxStyle: any = {
    display: "flex",
    alignItems: "center",
    whiteSpace: "nowrap",
  };
  const iconStyle: any = {
    sx: { mr: "8px", fontSize: 16 },
  };
  const valStyle: any = {
    component: "span",
    textAlign: "left",
    sx: { flex: "1 1 auto", userSelect: "none" },
  };
  const unitStyle: any = {
    component: "span",
    fontSize: "12px",
    textAlign: "right",
    sx: { flex: "0 1 auto", userSelect: "none", ml: 1 },
  };

  const timeStyle: any = {
    transition: "opacity 0.3s ease",
    opacity: pageVisible ? 1 : 0.7,
  };

  return (
    <LightweightTrafficErrorBoundary>
      <Box position="relative">
        {trafficGraph && pageVisible && (
          <div
            style={{ width: "100%", height: 60, marginBottom: 6 }}
            onClick={trafficRef.current?.toggleStyle}
          >
            <TrafficGraph ref={trafficRef} />
          </div>
        )}

        <Box display="flex" flexDirection="column" gap={0.75}>
          <Box
            title={`${t("Upload Speed")} ${traffic?.is_fresh ? "" : "(Stale)"}`}
            {...boxStyle}
            sx={{
              ...boxStyle.sx,
              opacity: traffic?.is_fresh ? 1 : 0.6,
            }}
          >
            <ArrowUpwardRounded
              {...iconStyle}
              color={
                (traffic?.raw?.up_rate || 0) > 0 ? "secondary" : "disabled"
              }
            />
            <Typography {...valStyle} color="secondary">
              {t("Upload Speed")}
            </Typography>
            <Typography {...unitStyle} color="secondary">
              {up} {upUnit}/s
            </Typography>
          </Box>

          <Box
            title={`${t("Download Speed")} ${traffic?.is_fresh ? "" : "(Stale)"}`}
            {...boxStyle}
            sx={{
              ...boxStyle.sx,
              opacity: traffic?.is_fresh ? 1 : 0.6,
            }}
          >
            <ArrowDownwardRounded
              {...iconStyle}
              color={
                (traffic?.raw?.down_rate || 0) > 0 ? "primary" : "disabled"
              }
            />
            <Typography {...valStyle} color="primary">
              {t("Download Speed")}
            </Typography>
            <Typography {...unitStyle} color="primary">
              {down} {downUnit}/s
            </Typography>
          </Box>

          {displayMemory && (
            <Box
              title={`${t(isDebug ? "Memory Cleanup" : "Memory Usage")} ${memory?.is_fresh ? "" : "(Stale)"} ${"usage_percent" in (memory?.formatted || {}) && memory.formatted.usage_percent ? `(${memory.formatted.usage_percent.toFixed(1)}%)` : ""}`}
              {...boxStyle}
              sx={{
                cursor: isDebug ? "pointer" : "auto",
                opacity: memory?.is_fresh ? 1 : 0.6,
              }}
              color={isDebug ? "success.main" : "disabled"}
              onClick={async () => {
                isDebug && (await gc());
              }}
            >
              <MemoryRounded {...iconStyle} />
              <Typography {...valStyle}>
                {t(isDebug ? "Memory Cleanup" : "Memory Usage")}
              </Typography>
              <Typography {...unitStyle}>
                {inuse} {inuseUnit}
                {("usage_percent" in (memory?.formatted || {}) && memory.formatted.usage_percent) &&
                  ` (${memory.formatted.usage_percent.toFixed(1)}%)`
                }
              </Typography>
            </Box>
          )}

         {displayRuntime && (
          <Box {...boxStyle} sx={timeStyle}>
            <AccessTimeRounded
              {...iconStyle}
              color="error.main"
            />
            <Typography {...valStyle} color="error.main">
              {t("Uptime")}
            </Typography>
            <Typography {...unitStyle} color="error.main">
              {uptime}
            </Typography>
          </Box>
          )}

       {displaysystemtime  && (
          <Box {...boxStyle} sx={timeStyle}>
            <AccessTimeRounded
              {...iconStyle}
              color="success.main"
            />
            <Typography {...valStyle} color="success.main">
              {t("System Time")}
            </Typography>
            <Typography {...unitStyle} color="success.main">
              {currentTime}
            </Typography>
          </Box>
          )}

        </Box>
      </Box>
    </LightweightTrafficErrorBoundary>
  );
};
