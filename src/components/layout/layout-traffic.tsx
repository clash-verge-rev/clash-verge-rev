import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import {
  ArrowDownward,
  ArrowUpward,
  MemoryOutlined,
} from "@mui/icons-material";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { TrafficGraph, type TrafficRef } from "./traffic-graph";
import { useLogSetup } from "./use-log-setup";
import { useVisibility } from "@/hooks/use-visibility";
import { useWebsocket } from "@/hooks/use-websocket";
import parseTraffic from "@/utils/parse-traffic";

// setup the traffic
export const LayoutTraffic = () => {
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const [traffic, setTraffic] = useState({ up: 0, down: 0 });
  const [memory, setMemory] = useState({ inuse: 0 });
  const pageVisible = useVisibility();

  // setup log ws during layout
  useLogSetup();

  const { connect, disconnect } = useWebsocket((event) => {
    const data = JSON.parse(event.data) as ITrafficItem;
    trafficRef.current?.appendData(data);
    setTraffic(data);
  });

  useEffect(() => {
    if (!clashInfo || !pageVisible) return;

    const { server = "", secret = "" } = clashInfo;
    connect(`ws://${server}/traffic?token=${encodeURIComponent(secret)}`);

    return () => {
      disconnect();
    };
  }, [clashInfo, pageVisible]);

  /* --------- meta memory information --------- */
  const isMetaCore = verge?.clash_core === "clash-meta";
  const displayMemory = isMetaCore && (verge?.enable_memory_usage ?? true);

  const memoryWs = useWebsocket(
    (event) => {
      setMemory(JSON.parse(event.data));
    },
    { onError: () => setMemory({ inuse: 0 }) }
  );

  useEffect(() => {
    if (!clashInfo || !pageVisible || !displayMemory) return;
    const { server = "", secret = "" } = clashInfo;
    memoryWs.connect(
      `ws://${server}/memory?token=${encodeURIComponent(secret)}`
    );
    return () => memoryWs.disconnect();
  }, [clashInfo, pageVisible, displayMemory]);

  const [up, upUnit] = parseTraffic(traffic.up);
  const [down, downUnit] = parseTraffic(traffic.down);
  const [inuse, inuseUnit] = parseTraffic(memory.inuse);

  const iconStyle: any = {
    sx: { mr: "8px", fontSize: 16 },
  };
  const valStyle: any = {
    component: "span",
    color: "primary",
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
    <Box
      width="110px"
      position="relative"
      onClick={trafficRef.current?.toggleStyle}
    >
      {trafficGraph && pageVisible && (
        <div style={{ width: "100%", height: 60, marginBottom: 6 }}>
          <TrafficGraph ref={trafficRef} />
        </div>
      )}

      <Box display="flex" flexDirection="column" gap={0.75}>
        <Box display="flex" alignItems="center" whiteSpace="nowrap">
          <ArrowUpward
            {...iconStyle}
            color={+up > 0 ? "primary" : "disabled"}
          />
          <Typography {...valStyle}>{up}</Typography>
          <Typography {...unitStyle}>{upUnit}/s</Typography>
        </Box>

        <Box display="flex" alignItems="center" whiteSpace="nowrap">
          <ArrowDownward
            {...iconStyle}
            color={+down > 0 ? "primary" : "disabled"}
          />
          <Typography {...valStyle}>{down}</Typography>
          <Typography {...unitStyle}>{downUnit}/s</Typography>
        </Box>

        {displayMemory && (
          <Box
            display="flex"
            alignItems="center"
            whiteSpace="nowrap"
            title="Memory Usage"
          >
            <MemoryOutlined {...iconStyle} color="disabled" />
            <Typography {...valStyle}>{inuse}</Typography>
            <Typography {...unitStyle}>{inuseUnit}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};
