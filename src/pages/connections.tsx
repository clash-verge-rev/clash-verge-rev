import { useEffect, useMemo, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, Paper, TextField } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { closeAllConnections, getInformation } from "@/services/api";
import BasePage from "@/components/base/base-page";
import ConnectionItem from "@/components/connection/connection-item";

const initConn = { uploadTotal: 0, downloadTotal: 0, connections: [] };

const ConnectionsPage = () => {
  const { t } = useTranslation();

  const [filterText, setFilterText] = useState("");
  const [connData, setConnData] = useState<ApiType.Connections>(initConn);

  const filterConn = useMemo(() => {
    return connData.connections.filter((conn) =>
      (conn.metadata.host || conn.metadata.destinationIP)?.includes(filterText)
    );
  }, [connData, filterText]);

  useEffect(() => {
    let ws: WebSocket | null = null;

    getInformation().then((result) => {
      const { server = "", secret = "" } = result;
      ws = new WebSocket(`ws://${server}/connections?token=${secret}`);

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data) as ApiType.Connections;

        // 与前一次connections的展示顺序尽量保持一致
        setConnData((old) => {
          const oldConn = old.connections;
          const maxLen = data.connections.length;

          const connections: typeof oldConn = [];

          const rest = data.connections.filter((each) => {
            const index = oldConn.findIndex((o) => o.id === each.id);

            if (index >= 0 && index < maxLen) {
              const old = oldConn[index];
              each.curUpload = each.upload - old.upload;
              each.curDownload = each.download - old.download;

              connections[index] = each;
              return false;
            }
            return true;
          });

          for (let i = 0; i < maxLen; ++i) {
            if (!connections[i] && rest.length > 0) {
              connections[i] = rest.shift()!;
              connections[i].curUpload = 0;
              connections[i].curDownload = 0;
            }
          }

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
        <Box
          sx={{
            pt: 1,
            mb: 0.5,
            mx: "12px",
            height: "36px",
            display: "flex",
            alignItems: "center",
          }}
        >
          {/* <Select
            size="small"
            autoComplete="off"
            value={logState}
            onChange={(e) => setLogState(e.target.value)}
            sx={{ width: 120, mr: 1, '[role="button"]': { py: 0.65 } }}
          >
            <MenuItem value="all">ALL</MenuItem>
            <MenuItem value="info">INFO</MenuItem>
            <MenuItem value="warn">WARN</MenuItem>
          </Select> */}

          <TextField
            hiddenLabel
            fullWidth
            size="small"
            autoComplete="off"
            variant="outlined"
            placeholder="Filter conditions"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            sx={{ input: { py: 0.65, px: 1.25 } }}
          />
        </Box>

        <Box height="calc(100% - 50px)">
          <Virtuoso
            data={filterConn}
            itemContent={(index, item) => <ConnectionItem value={item} />}
          />
        </Box>
      </Paper>
    </BasePage>
  );
};

export default ConnectionsPage;
