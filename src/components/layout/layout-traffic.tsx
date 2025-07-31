import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  MemoryRounded,
} from "@mui/icons-material";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { TrafficGraph, type TrafficRef } from "./traffic-graph";
import { useVisibility } from "@/hooks/use-visibility";
import parseTraffic from "@/utils/parse-traffic";
import { useTranslation } from "react-i18next";
import { isDebugEnabled, gc, startTrafficService } from "@/services/cmds";
import { useTrafficDataEnhanced } from "@/hooks/use-traffic-monitor";
import { LightweightTrafficErrorBoundary } from "@/components/common/traffic-error-boundary";
import useSWR from "swr";

interface MemoryUsage {
  inuse: number;
  oslimit?: number;
}

// setup the traffic
export const LayoutTraffic = () => {
  const { data: isDebug } = useSWR(
    "clash-verge-rev-internal://isDebugEnabled",
    () => isDebugEnabled(),
    {
      // default value before is fetched
      fallbackData: false,
    },
  );

  if (isDebug) {
    console.debug("[Traffic][LayoutTraffic] 组件正在渲染");
  }
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();

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

  // 使用parseTraffic统一处理转换，保持与首页一致的显示格式
  const [up, upUnit] = parseTraffic(traffic?.raw?.up_rate || 0);
  const [down, downUnit] = parseTraffic(traffic?.raw?.down_rate || 0);
  const [inuse, inuseUnit] = parseTraffic(memory?.raw?.inuse || 0);

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
    textAlign: "center",
    sx: { flex: "1 1 56px", userSelect: "none" },
  };
  const unitStyle: any = {
    component: "span",
    color: "grey.500",
    fontSize: "12px",
    textAlign: "right",
    sx: { flex: "0 1 27px", userSelect: "none" },
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
              {up}
            </Typography>
            <Typography {...unitStyle}>{upUnit}/s</Typography>
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
              {down}
            </Typography>
            <Typography {...unitStyle}>{downUnit}/s</Typography>
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
              <Typography {...valStyle}>{inuse}</Typography>
              <Typography {...unitStyle}>{inuseUnit}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </LightweightTrafficErrorBoundary>
  );
};
