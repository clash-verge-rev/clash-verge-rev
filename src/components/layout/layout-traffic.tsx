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
import useSWRSubscription from "swr/subscription";
import { createSockette, createAuthSockette } from "@/utils/websocket";
import { useTranslation } from "react-i18next";
import { isDebugEnabled, gc } from "@/services/api";

interface MemoryUsage {
  inuse: number;
  oslimit?: number;
}

// setup the traffic
export const LayoutTraffic = () => {
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const pageVisible = useVisibility();
  const [isDebug, setIsDebug] = useState(false);

  useEffect(() => {
    isDebugEnabled().then((flag) => setIsDebug(flag));
    return () => {};
  }, [isDebug]);

  const { data: traffic = { up: 0, down: 0 } } = useSWRSubscription<
    ITrafficItem,
    any,
    "getRealtimeTraffic" | null
  >(
    clashInfo && pageVisible ? "getRealtimeTraffic" : null,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      if (!server) {
        console.warn("[Traffic] 服务器地址为空，无法建立连接");
        next(null, { up: 0, down: 0 });
        return () => {};
      }

      console.log(`[Traffic] 正在连接: ${server}/traffic`);

      const s = createAuthSockette(`${server}/traffic`, secret, {
        timeout: 8000, // 8秒超时
        onmessage(event) {
          const data = JSON.parse(event.data) as ITrafficItem;
          trafficRef.current?.appendData(data);
          next(null, data);
        },
        onerror(event) {
          console.error("[Traffic] WebSocket 连接错误", event);
          this.close();
          next(null, { up: 0, down: 0 });
        },
        onclose(event) {
          console.log("[Traffic] WebSocket 连接关闭", event);
        },
        onopen(event) {
          console.log("[Traffic] WebSocket 连接已建立");
        },
      });

      return () => {
        console.log("[Traffic] 清理WebSocket连接");
        try {
          s.close();
        } catch (e) {
          console.error("[Traffic] 关闭连接时出错", e);
        }
      };
    },
    {
      fallbackData: { up: 0, down: 0 },
      keepPreviousData: true,
    },
  );

  /* --------- meta memory information --------- */

  const displayMemory = verge?.enable_memory_usage ?? true;

  const { data: memory = { inuse: 0 } } = useSWRSubscription<
    MemoryUsage,
    any,
    "getRealtimeMemory" | null
  >(
    clashInfo && pageVisible && displayMemory ? "getRealtimeMemory" : null,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      if (!server) {
        console.warn("[Memory] 服务器地址为空，无法建立连接");
        next(null, { inuse: 0 });
        return () => {};
      }

      console.log(`[Memory] 正在连接: ${server}/memory`);

      const s = createAuthSockette(`${server}/memory`, secret, {
        timeout: 8000, // 8秒超时
        onmessage(event) {
          const data = JSON.parse(event.data) as MemoryUsage;
          next(null, data);
        },
        onerror(event) {
          console.error("[Memory] WebSocket 连接错误", event);
          this.close();
          next(null, { inuse: 0 });
        },
        onclose(event) {
          console.log("[Memory] WebSocket 连接关闭", event);
        },
        onopen(event) {
          console.log("[Memory] WebSocket 连接已建立");
        },
      });

      return () => {
        console.log("[Memory] 清理WebSocket连接");
        try {
          s.close();
        } catch (e) {
          console.error("[Memory] 关闭连接时出错", e);
        }
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
