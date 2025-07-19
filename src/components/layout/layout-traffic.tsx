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
import {
  isDebugEnabled,
  gc,
  getTrafficData,
  getMemoryData,
  startTrafficService,
} from "@/services/cmds";
import useSWR from "swr";

interface MemoryUsage {
  inuse: number;
  oslimit?: number;
}

// setup the traffic
export const LayoutTraffic = () => {
  console.log("[Traffic][LayoutTraffic] 组件正在渲染");
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const pageVisible = useVisibility();

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

  const { data: isDebug } = useSWR(
    "clash-verge-rev-internal://isDebugEnabled",
    () => isDebugEnabled(),
    {
      // default value before is fetched
      fallbackData: false,
    },
  );

  const { data: traffic = { up: 0, down: 0 } } = useSWR<ITrafficItem>(
    clashInfo && pageVisible ? "getTrafficData" : null,
    getTrafficData,
    {
      refreshInterval: 1000, // 1秒刷新一次
      fallbackData: { up: 0, down: 0 },
      keepPreviousData: true,
      onSuccess: (data) => {
        console.log("[Traffic][LayoutTraffic] IPC 获取到流量数据:", data);
        if (data && trafficRef.current) {
          trafficRef.current.appendData(data);
        }
      },
      onError: (error) => {
        console.error("[Traffic][LayoutTraffic] IPC 获取数据错误:", error);
      },
    },
  );

  /* --------- meta memory information --------- */

  const displayMemory = verge?.enable_memory_usage ?? true;

  const { data: memory = { inuse: 0 } } = useSWR<MemoryUsage>(
    clashInfo && pageVisible && displayMemory ? "getMemoryData" : null,
    getMemoryData,
    {
      refreshInterval: 2000, // 2秒刷新一次
      fallbackData: { inuse: 0 },
      keepPreviousData: true,
      onSuccess: (data) => {
        console.log("[Memory][LayoutTraffic] IPC 获取到内存数据:", data);
      },
      onError: (error) => {
        console.error("[Memory][LayoutTraffic] IPC 获取数据错误:", error);
      },
    },
  );

  const [up, upUnit] = parseTraffic(traffic.up);
  const [down, downUnit] = parseTraffic(traffic.down);
  const [inuse, inuseUnit] = parseTraffic(memory.inuse);

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
        <Box title={t("Upload Speed")} {...boxStyle}>
          <ArrowUpwardRounded
            {...iconStyle}
            color={+up > 0 ? "secondary" : "disabled"}
          />
          <Typography {...valStyle} color="secondary">
            {up}
          </Typography>
          <Typography {...unitStyle}>{upUnit}/s</Typography>
        </Box>

        <Box title={t("Download Speed")} {...boxStyle}>
          <ArrowDownwardRounded
            {...iconStyle}
            color={+down > 0 ? "primary" : "disabled"}
          />
          <Typography {...valStyle} color="primary">
            {down}
          </Typography>
          <Typography {...unitStyle}>{downUnit}/s</Typography>
        </Box>

        {displayMemory && (
          <Box
            title={t(isDebug ? "Memory Cleanup" : "Memory Usage")}
            {...boxStyle}
            sx={{ cursor: isDebug ? "pointer" : "auto" }}
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
  );
};
