import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { Button, Paper } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { ApiType } from "../services/types";
import { getInfomation } from "../services/api";
import BasePage from "../components/base-page";
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

  const onClear = () => {
    setLogData([]);
    logCache = [];
  };

  return (
    <BasePage
      title="Logs"
      contentStyle={{ height: "100%" }}
      header={
        <Button
          size="small"
          sx={{ mt: 1 }}
          variant="contained"
          onClick={onClear}
        >
          Clear
        </Button>
      }
    >
      <Paper sx={{ boxShadow: 2, height: "100%" }}>
        <Virtuoso
          initialTopMostItemIndex={999}
          data={logData}
          itemContent={(index, item) => <LogItem value={item} />}
          followOutput={"smooth"}
        />
      </Paper>
    </BasePage>
  );
};

export default LogPage;
