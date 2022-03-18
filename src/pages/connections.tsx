import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { Button, Paper } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { ApiType } from "../services/types";
import { closeAllConnections, getInfomation } from "../services/api";
import BasePage from "../components/base/base-page";
import ConnectionItem from "../components/connection/connection-item";

const ConnectionsPage = () => {
  const initConn = { uploadTotal: 0, downloadTotal: 0, connections: [] };

  const { t } = useTranslation();
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

  const onCloseAll = useLockFn(closeAllConnections);

  return (
    <BasePage
      title={t("Connections")}
      contentStyle={{ height: "100%" }}
      header={
        <Button
          size="small"
          sx={{ mt: 1 }}
          variant="contained"
          onClick={onCloseAll}
        >
          {t("Close All")}
        </Button>
      }
    >
      <Paper sx={{ boxShadow: 2, height: "100%" }}>
        <Virtuoso
          initialTopMostItemIndex={999}
          data={conn.connections}
          itemContent={(index, item) => <ConnectionItem value={item} />}
        />
      </Paper>
    </BasePage>
  );
};

export default ConnectionsPage;
