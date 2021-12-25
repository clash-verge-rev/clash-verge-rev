import { useEffect, useState } from "react";
import { Box, Paper, Typography } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { getInfomation } from "../services/api";
import { ApiType } from "../services/types";
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
    <Box
      sx={{
        width: 0.9,
        maxWidth: "850px",
        height: "100%",
        mx: "auto",
      }}
    >
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Connections
      </Typography>

      <Paper sx={{ boxShadow: 2, height: "calc(100% - 100px)" }}>
        <Virtuoso
          data={conn.connections}
          itemContent={(index, item) => <ConnectionItem value={item} />}
        />
      </Paper>
    </Box>
  );
};

export default ConnectionsPage;
