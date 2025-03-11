import { Notice } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { useLogData } from "@/hooks/use-log-data";
import { useVerge } from "@/hooks/use-verge";
import { useVisibility } from "@/hooks/use-visibility";
import parseTraffic from "@/utils/parse-traffic";
import { createSockette } from "@/utils/websocket";
import {
  ArrowDownward,
  ArrowUpward,
  MemoryOutlined,
} from "@mui/icons-material";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";
import { t } from "i18next";
import { useRef } from "react";
import useSWRSubscription from "swr/subscription";
import { TrafficGraph, type TrafficRef } from "./traffic-graph";
import { restart } from "tauri-plugin-mihomo-api";

interface MemoryUsage {
  inuse: number;
  oslimit?: number;
}

// setup the traffic
export const LayoutTraffic = () => {
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const pageVisible = useVisibility();

  // https://swr.vercel.app/docs/subscription#deduplication
  // useSWRSubscription auto deduplicates to one subscription per key per entire app
  // So we can simply invoke it here acting as preconnect
  useLogData();
  const subscriptionTrafficKey =
    clashInfo && pageVisible
      ? `getRealtimeTraffic-${clashInfo?.server}-${clashInfo?.secret}-${pageVisible}`
      : null;

  const { data: traffic = { up: 0, down: 0 } } = useSWRSubscription<
    ITrafficItem,
    any,
    string | null
  >(
    subscriptionTrafficKey,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      const s = createSockette(
        `ws://${server}/traffic?token=${encodeURIComponent(secret)}`,
        {
          onmessage(event) {
            const data = JSON.parse(event.data) as ITrafficItem;
            trafficRef.current?.appendData(data);
            next(null, data);
          },
          onerror(event) {
            this.close();
            next(event, { up: 0, down: 0 });
          },
        },
      );

      return () => {
        s.close();
      };
    },
    {
      fallbackData: { up: 0, down: 0 },
      keepPreviousData: true,
    },
  );

  /* --------- meta memory information --------- */

  const displayMemory = verge?.enable_memory_usage ?? true;

  const subscriptionMemoryKey =
    clashInfo && pageVisible && displayMemory
      ? `getRealtimeMemory-${clashInfo?.server}-${clashInfo?.secret}-${pageVisible}`
      : null;
  const { data: memory = { inuse: 0 } } = useSWRSubscription<
    MemoryUsage,
    any,
    string | null
  >(
    subscriptionMemoryKey,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      const s = createSockette(
        `ws://${server}/memory?token=${encodeURIComponent(secret)}`,
        {
          onmessage(event) {
            const data = JSON.parse(event.data) as MemoryUsage;
            next(null, data);
          },
          onerror(event) {
            this.close();
            next(event, { inuse: 0 });
          },
        },
      );

      return () => {
        s.close();
      };
    },
    {
      fallbackData: { inuse: 0 },
      keepPreviousData: true,
    },
  );

  const [up, upUnit] = parseTraffic(traffic.up);
  const [down, downUnit] = parseTraffic(traffic.down);
  const [inuse, inuseUnit] = parseTraffic(memory.inuse);

  const iconStyle: any = {
    sx: { fontSize: 16 },
  };
  const valStyle: any = {
    component: "span",
    // color: "primary",
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

  const restartClashCore = useLockFn(async () => {
    await restart();
    Notice.success(t("Clash Core Restarted"));
  });

  return (
    <Box width={"100%"} onClick={trafficRef.current?.toggleStyle}>
      {trafficGraph && pageVisible && (
        <div style={{ width: "100%", height: 60, marginBottom: 6 }}>
          <TrafficGraph ref={trafficRef} />
        </div>
      )}

      <Box display="flex" flexDirection="column" gap={0.75}>
        <Box display="flex" alignItems="center" whiteSpace="nowrap">
          <ArrowUpward
            {...iconStyle}
            color={+up > 0 ? "secondary" : "disabled"}
          />
          <Typography {...valStyle} color="secondary">
            {up}
          </Typography>
          <Typography {...unitStyle}>{upUnit}/s</Typography>
        </Box>

        <Box display="flex" alignItems="center" whiteSpace="nowrap">
          <ArrowDownward
            {...iconStyle}
            color={+down > 0 ? "primary" : "disabled"}
          />
          <Typography {...valStyle} color="primary">
            {down}
          </Typography>
          <Typography {...unitStyle}>{downUnit}/s</Typography>
        </Box>

        {displayMemory && (
          <Box display="flex" alignItems="center" whiteSpace="nowrap">
            <Tooltip title={t("Restart")}>
              <IconButton
                color="primary"
                sx={{ p: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  restartClashCore();
                }}>
                <MemoryOutlined {...iconStyle} />
              </IconButton>
            </Tooltip>
            <Box
              title={t("Memory Usage")}
              display={"flex"}
              flexGrow={1}
              alignItems={"center"}>
              <Typography {...valStyle}>{inuse}</Typography>
              <Typography {...unitStyle}>{inuseUnit}</Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
