import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { ArrowDownward, ArrowUpward } from "@mui/icons-material";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { TrafficGraph, type TrafficRef } from "./traffic-graph";
import { useLogSetup } from "./use-log-setup";
import { useVisibility } from "@/hooks/use-visibility";
import { useWebsocket } from "@/hooks/use-websocket";
import parseTraffic from "@/utils/parse-traffic";

// setup the traffic
const LayoutTraffic = () => {
  const { clashInfo } = useClashInfo();

  // whether hide traffic graph
  const { verge } = useVerge();
  const trafficGraph = verge?.traffic_graph ?? true;

  const trafficRef = useRef<TrafficRef>(null);
  const [traffic, setTraffic] = useState({ up: 0, down: 0 });

  // setup log ws during layout
  useLogSetup();

  const { connect, disconnect } = useWebsocket((event) => {
    const data = JSON.parse(event.data) as ITrafficItem;
    trafficRef.current?.appendData(data);
    setTraffic(data);
  });

  const pageVisible = useVisibility();

  useEffect(() => {
    if (!clashInfo || !pageVisible) return;

    const { server = "", secret = "" } = clashInfo;
    connect(`ws://${server}/traffic?token=${encodeURIComponent(secret)}`);

    return () => {
      disconnect();
    };
  }, [clashInfo, pageVisible]);

  const [up, upUnit] = parseTraffic(traffic.up);
  const [down, downUnit] = parseTraffic(traffic.down);

  const valStyle: any = {
    component: "span",
    color: "primary",
    textAlign: "center",
    sx: { flex: "1 1 54px", userSelect: "none" },
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

      <Box mb={1.5} display="flex" alignItems="center" whiteSpace="nowrap">
        <ArrowUpward
          sx={{ mr: 0.75, fontSize: 18 }}
          color={+up > 0 ? "primary" : "disabled"}
        />
        <Typography {...valStyle}>{up}</Typography>
        <Typography {...unitStyle}>{upUnit}/s</Typography>
      </Box>

      <Box display="flex" alignItems="center" whiteSpace="nowrap">
        <ArrowDownward
          sx={{ mr: 0.75, fontSize: 18 }}
          color={+down > 0 ? "primary" : "disabled"}
        />
        <Typography {...valStyle}>{down}</Typography>
        <Typography {...unitStyle}>{downUnit}/s</Typography>
      </Box>
    </Box>
  );
};

export default LayoutTraffic;
