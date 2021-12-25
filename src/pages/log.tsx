import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { ApiType } from "../services/types";
import { getInfomation } from "../services/api";
import LogItem from "../components/log-item";

let logCache: ApiType.LogItem[] = [];

const LogPage = () => {
  const [logData, setLogData] = useState(logCache);

  useEffect(() => {
    let ws: WebSocket | null = null;

    getInfomation().then((result) => {
      const { server = "", secret = "" } = result;
      ws = new WebSocket(`ws://${server}/logs?token=${secret}`);

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data) as ApiType.LogItem;
        const time = dayjs().format("MM-DD HH:mm:ss");
        setLogData((l) => (logCache = [...l, { ...data, time }]));
      });
    });

    return () => ws?.close();
  }, []);

  return (
    <Box
      sx={{
        position: "relative",
        width: 0.9,
        maxWidth: "850px",
        height: "100%",
        mx: "auto",
      }}
    >
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Logs
      </Typography>

      <Button
        size="small"
        variant="contained"
        sx={{ position: "absolute", top: 22, right: 0 }}
        onClick={() => {
          setLogData([]);
          logCache = [];
        }}
      >
        Clear
      </Button>

      <Paper sx={{ boxShadow: 2, height: "calc(100% - 100px)" }}>
        <Virtuoso
          initialTopMostItemIndex={999}
          data={logData}
          itemContent={(index, item) => <LogItem value={item} />}
          followOutput={"smooth"}
        />
      </Paper>
    </Box>
  );
};

export default LogPage;
