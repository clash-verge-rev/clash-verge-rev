import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { Box, Typography } from "@mui/material";
import { ArrowDownward, ArrowUpward } from "@mui/icons-material";
import { listen } from "@tauri-apps/api/event";
import { getInformation } from "@/services/api";
import { getVergeConfig } from "@/services/cmds";
import { atomClashPort } from "@/services/states";
import TrafficGraph from "./traffic-graph";
import useLogSetup from "./use-log-setup";
import parseTraffic from "@/utils/parse-traffic";

// setup the traffic
const LayoutTraffic = () => {
  const portValue = useRecoilValue(atomClashPort);
  const [traffic, setTraffic] = useState({ up: 0, down: 0 });
  const [refresh, setRefresh] = useState({});

  const trafficRef = useRef<any>();

  // whether hide traffic graph
  const { data } = useSWR("getVergeConfig", getVergeConfig);
  const trafficGraph = data?.traffic_graph ?? true;

  // setup log ws during layout
  useLogSetup();

  useEffect(() => {
    // should reconnect the traffic ws
    const unlisten = listen("verge://refresh-clash-config", () =>
      setRefresh({})
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;

    getInformation().then((result) => {
      const { server = "", secret = "" } = result;
      ws = new WebSocket(`ws://${server}/traffic?token=${secret}`);

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data) as ApiType.TrafficItem;
        trafficRef.current?.appendData(data);
        setTraffic(data);
      });
    });

    return () => ws?.close();
  }, [portValue, refresh]);

  const [up, upUnit] = parseTraffic(traffic.up);
  const [down, downUnit] = parseTraffic(traffic.down);

  const valStyle: any = {
    component: "span",
    color: "primary",
    textAlign: "center",
    sx: { flex: "1 1 54px" },
  };
  const unitStyle: any = {
    component: "span",
    color: "grey.500",
    fontSize: "12px",
    textAlign: "right",
    sx: { flex: "0 1 28px", userSelect: "none" },
  };

  return (
    <Box
      width="110px"
      position="relative"
      onClick={trafficRef.current?.toggleStyle}
    >
      {trafficGraph && (
        <div style={{ width: "100%", height: 60, marginBottom: 6 }}>
          <TrafficGraph instance={trafficRef} />
        </div>
      )}

      <Box mb={1.5} display="flex" alignItems="center" whiteSpace="nowrap">
        <ArrowUpward
          fontSize="small"
          color={+up > 0 ? "primary" : "disabled"}
        />
        <Typography {...valStyle}>{up}</Typography>
        <Typography {...unitStyle}>{upUnit}/s</Typography>
      </Box>

      <Box display="flex" alignItems="center" whiteSpace="nowrap">
        <ArrowDownward
          fontSize="small"
          color={+down > 0 ? "primary" : "disabled"}
        />
        <Typography {...valStyle}>{down}</Typography>
        <Typography {...unitStyle}>{downUnit}/s</Typography>
      </Box>
    </Box>
  );
};

export default LayoutTraffic;
