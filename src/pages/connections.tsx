import { useEffect, useState } from "react";
import { Paper } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { ApiType } from "../services/types";
import { getInfomation } from "../services/api";
import BasePage from "../components/base-page";
import ConnectionItem from "../components/connection-item";

const ConnectionsPage = () => {
  const initConn = { uploadTotal: 0, downloadTotal: 0, connections: [] };
  const [conn, setConn] = useState<ApiType.Connections>(initConn);

  useEffect(() => {
    let ws: WebSocket | null = null;

    getInfomation().then((result) => {
      const { server = "", secret = "" } = result;
      ws = new WebSocket(`ws://${server}/connections?token=${secret}`);

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data) as ApiType.Connections;
        setConn(data);
      });
    });

    return () => ws?.close();
  }, []);

  return (
    <BasePage title="Connections" contentStyle={{ height: "100%" }}>
      <Paper sx={{ boxShadow: 2, height: "100%" }}>
        <Virtuoso
          data={conn.connections}
          itemContent={(index, item) => <ConnectionItem value={item} />}
        />
      </Paper>
    </BasePage>
  );
};

export default ConnectionsPage;
