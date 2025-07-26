import { useConnectionData } from "@/hooks/use-connection-data";
import { useLogData } from "@/hooks/use-log-data";
import { useMemoryData } from "@/hooks/use-memory-data";
import { useTrafficData } from "@/hooks/use-traffic-data";
import { useVerge } from "@/hooks/use-verge";
import { useVisibility } from "@/hooks/use-visibility";
import parseTraffic from "@/utils/parse-traffic";
import {
  ArrowDownward,
  ArrowUpward,
  MemoryOutlined,
} from "@mui/icons-material";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { emit } from "@tauri-apps/api/event";
import { useLockFn } from "ahooks";
import { t } from "i18next";
import { useEffect, useRef } from "react";
import { restart } from "tauri-plugin-mihomo-api";
import { useNotice } from "../base/notifice";
import { TrafficGraph, type TrafficRef } from "./traffic-graph";

// setup the traffic
export const LayoutTraffic = () => {
  const { verge } = useVerge();
  const { notice } = useNotice();

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const pageVisible = useVisibility();
  const displayMemory = verge?.enable_memory_usage ?? true;

  // init mihomo websocket data
  const {
    response: { data: traffic = { up: 0, down: 0 } },
  } = useTrafficData();
  const {
    response: { data: memory = { inuse: 0 } },
  } = useMemoryData();
  useLogData();
  useConnectionData();

  useEffect(() => {
    if (trafficRef.current) trafficRef.current.appendData(traffic);
  }, [traffic]);

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
    notice("success", t("Clash Core Restarted"));
    setTimeout(async () => {
      await emit("verge://refresh-websocket");
    }, 1000);
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
