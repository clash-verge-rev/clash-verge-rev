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
  const [connData, setConnData] = useState<ApiType.Connections>(initConn);

  useEffect(() => {
    let ws: WebSocket | null = null;

    getInfomation().then((result) => {
      const { server = "", secret = "" } = result;
      ws = new WebSocket(`ws://${server}/connections?token=${secret}`);

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data) as ApiType.Connections;
        setConnData((old) => {
          const oldConn = old.connections;
          const oldList = oldConn.map((each) => each.id);
          const maxLen = data.connections.length;

          const connections: typeof oldConn = [];

          // 与前一次连接的顺序尽量保持一致
          data.connections
            .filter((each) => {
              const index = oldList.indexOf(each.id);

              if (index >= 0 && index < maxLen) {
                connections[index] = each;
                return false;
              }
              return true;
            })
            .forEach((each) => {
              for (let i = 0; i < maxLen; ++i) {
                if (!connections[i]) {
                  connections[i] = each;
                  return;
                }
              }
            });

          return { ...data, connections };
        });
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
          data={connData.connections}
          itemContent={(index, item) => <ConnectionItem value={item} />}
        />
      </Paper>
    </BasePage>
  );
};

export default ConnectionsPage;
