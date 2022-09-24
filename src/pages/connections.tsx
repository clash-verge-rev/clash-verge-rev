import { useEffect, useMemo, useState } from "react";
import { useLockFn } from "ahooks";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
} from "@mui/material";
import { useRecoilState } from "recoil";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { TableChartRounded, TableRowsRounded } from "@mui/icons-material";
import { closeAllConnections, getInformation } from "@/services/api";
import { atomConnectionSetting } from "@/services/states";
import BasePage from "@/components/base/base-page";
import BaseEmpty from "@/components/base/base-empty";
import ConnectionItem from "@/components/connection/connection-item";
import ConnectionTable from "@/components/connection/connection-table";

const initConn = { uploadTotal: 0, downloadTotal: 0, connections: [] };

type OrderFunc = (list: ApiType.ConnectionsItem[]) => ApiType.ConnectionsItem[];

const ConnectionsPage = () => {
  const { t, i18n } = useTranslation();

  const [filterText, setFilterText] = useState("");
  const [curOrderOpt, setOrderOpt] = useState("Default");
  const [connData, setConnData] = useState<ApiType.Connections>(initConn);

  const [setting, setSetting] = useRecoilState(atomConnectionSetting);

  const isTableLayout = setting.layout === "table";

  const orderOpts: Record<string, OrderFunc> = {
    Default: (list) => list,
    "Upload Speed": (list) => list.sort((a, b) => b.curUpload! - a.curUpload!),
    "Download Speed": (list) =>
      list.sort((a, b) => b.curDownload! - a.curDownload!),
  };

  const filterConn = useMemo(() => {
    const orderFunc = orderOpts[curOrderOpt];
    const connetions = connData.connections.filter((conn) =>
      (conn.metadata.host || conn.metadata.destinationIP)?.includes(filterText)
    );

    if (orderFunc) return orderFunc(connetions);
    return connetions;
  }, [connData, filterText, curOrderOpt]);

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
        <Box sx={{ mt: 1, display: "flex", alignItems: "center" }}>
          <IconButton
            size="small"
            sx={{ mr: 2 }}
            onClick={() =>
              setSetting((o) =>
                o.layout === "list"
                  ? { ...o, layout: "table" }
                  : { ...o, layout: "list" }
              )
            }
          >
            {isTableLayout ? (
              <TableChartRounded fontSize="inherit" />
            ) : (
              <TableRowsRounded fontSize="inherit" />
            )}
          </IconButton>

          <Button size="small" variant="contained" onClick={onCloseAll}>
            {t("Close All")}
          </Button>
        </Box>
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
          {!isTableLayout && (
            <Select
              size="small"
              autoComplete="off"
              value={curOrderOpt}
              onChange={(e) => setOrderOpt(e.target.value)}
              sx={{
                mr: 1,
                width: i18n.language === "en" ? 190 : 120,
                '[role="button"]': { py: 0.65 },
              }}
            >
              {Object.keys(orderOpts).map((opt) => (
                <MenuItem key={opt} value={opt}>
                  <span style={{ fontSize: 14 }}>{t(opt)}</span>
                </MenuItem>
              ))}
            </Select>
          )}

          <TextField
            hiddenLabel
            fullWidth
            size="small"
            autoComplete="off"
            variant="outlined"
            placeholder={t("Filter conditions")}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            sx={{ input: { py: 0.65, px: 1.25 } }}
          />
        </Box>

        <Box height="calc(100% - 50px)">
          {filterConn.length === 0 ? (
            <BaseEmpty text="No Connections" />
          ) : isTableLayout ? (
            <ConnectionTable connections={filterConn} />
          ) : (
            <Virtuoso
              data={filterConn}
              itemContent={(index, item) => <ConnectionItem value={item} />}
            />
          )}
        </Box>
      </Paper>
    </BasePage>
  );
};

export default ConnectionsPage;
