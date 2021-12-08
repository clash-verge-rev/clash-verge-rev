import axios from "axios";
import { useEffect, useState } from "react";
import { ArrowDownward, ArrowUpward } from "@mui/icons-material";
import parseTraffic from "../utils/parse-traffic";
import { Typography } from "@mui/material";
import { Box } from "@mui/system";

const Traffic = () => {
  const [traffic, setTraffic] = useState({ up: 0, down: 0 });

  useEffect(() => {
    const onTraffic = () => {
      axios({
        url: `http://127.0.0.1:9090/traffic`,
        method: "GET",
        onDownloadProgress: (progressEvent) => {
          const data = progressEvent.currentTarget.response || "";
          const lastData = data.slice(data.trim().lastIndexOf("\n") + 1);
          try {
            if (lastData) setTraffic(JSON.parse(lastData));
          } catch {}
        },
      }).catch(() => setTimeout(onTraffic, 500));
    };

    onTraffic();
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
      <Box mb={2} display="flex" alignItems="center" whiteSpace="nowrap">
        <ArrowUpward
          fontSize="small"
          color={+up > 0 ? "primary" : "disabled"}
        />
        <Typography {...valStyle}>{up}</Typography>
        <Typography {...unitStyle}>{upUnit}</Typography>
      </Box>

      <Box display="flex" alignItems="center" whiteSpace="nowrap">
        <ArrowDownward
          fontSize="small"
          color={+down > 0 ? "primary" : "disabled"}
        />
        <Typography {...valStyle}>{down}</Typography>
        <Typography {...unitStyle}>{downUnit}</Typography>
      </Box>
    </Box>
  );
};

export default Traffic;
