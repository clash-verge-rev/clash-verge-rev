import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { ArrowDownward, ArrowUpward } from "@mui/icons-material";
import { getInfomation } from "../services/api";
import { ApiType } from "../services/types";
import parseTraffic from "../utils/parse-traffic";

const Traffic = () => {
  const [traffic, setTraffic] = useState({ up: 0, down: 0 });

  useEffect(() => {
    const { server, secret } = getInfomation();
    const ws = new WebSocket(`ws://${server}/traffic?token=${secret}`);

    ws.addEventListener("message", (event) => {
      setTraffic(JSON.parse(event.data) as ApiType.TrafficItem);
    });

    return () => ws.close();
  }, []);

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
    <Box width="110px">
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

export default Traffic;
