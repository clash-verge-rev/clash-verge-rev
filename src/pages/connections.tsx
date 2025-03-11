import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  BaseStyledSelect,
} from "@/components/base";
import {
  ConnectionDetail,
  ConnectionDetailRef,
} from "@/components/connection/connection-detail";
import { ConnectionItem } from "@/components/connection/connection-item";
import { ConnectionTable } from "@/components/connection/connection-table";
import { useClashInfo } from "@/hooks/use-clash";
import { useConnectionSetting } from "@/services/states";
import parseTraffic from "@/utils/parse-traffic";
import { createSockette } from "@/utils/websocket";
import { TableChartRounded, TableRowsRounded } from "@mui/icons-material";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
import { useLockFn } from "ahooks";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import useSWRSubscription from "swr/subscription";
import { closeAllConnections, closeConnections } from "tauri-plugin-mihomo-api";

const initConn: IConnections = {
  uploadTotal: 0,
  downloadTotal: 0,
  connections: [],
};

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const [match, setMatch] = useState(() => (_: string) => true);
  const [curOrderOpt, setOrderOpt] = useState("Default");

  const [setting, setSetting] = useConnectionSetting();

  const isTableLayout = setting.layout === "table";

  const orderOpts: Record<string, OrderFunc> = {
    Default: (list) =>
      list.sort(
        (a, b) =>
          new Date(b.start || "0").getTime()! -
          new Date(a.start || "0").getTime()!,
      ),
    "Upload Speed": (list) => list.sort((a, b) => b.curUpload! - a.curUpload!),
    "Download Speed": (list) =>
      list.sort((a, b) => b.curDownload! - a.curDownload!),
  };

  const subscriptConnKey = clashInfo
    ? `getClashConnections-${clashInfo.server}-${clashInfo.secret}`
    : null;

  const { data: connData = initConn } = useSWRSubscription<
    IConnections,
    any,
    string | null
  >(subscriptConnKey, (_key, { next }) => {
    const { server = "", secret = "" } = clashInfo!;

    const s = createSockette(
      `ws://${server}/connections?token=${encodeURIComponent(secret)}`,
      {
        onmessage(event) {
          // meta v1.15.0 出现 data.connections 为 null 的情况
          const data = JSON.parse(event.data) as IConnections;
          // 尽量与前一次 connections 的展示顺序保持一致
          next(null, (old = initConn) => {
            const oldConn = old.connections;
            const maxLen = data.connections?.length;

            const connections: IConnectionsItem[] = [];

            const rest = (data.connections || []).filter((each) => {
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
        },
        onerror(event) {
          next(event);
        },
      },
      3,
    );

    return () => {
      if (s) s.close();
    };
  });

  const [filterConn] = useMemo(() => {
    const orderFunc = orderOpts[curOrderOpt];
    let connections = connData.connections.filter((conn) =>
      match(conn.metadata.host || conn.metadata.destinationIP || ""),
    );

    if (orderFunc) connections = orderFunc(connections);

    return [connections];
  }, [connData, match, curOrderOpt]);

  const onCloseAll = useLockFn(async () => {
    if (filterConn.length === connData.connections.length) {
      await closeAllConnections();
    } else {
      filterConn.forEach(async (conn) => await closeConnections(conn.id));
    }
  });

  const detailRef = useRef<ConnectionDetailRef>(null!);

  return (
    <BasePage
      full
      title={<span style={{ whiteSpace: "nowrap" }}>{t("Connections")}</span>}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ mx: 1 }}>
            {t("Total Downloaded")}: {parseTraffic(connData.downloadTotal)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("Total Uploaded")}: {parseTraffic(connData.uploadTotal)}
          </Box>
          <IconButton
            color="inherit"
            size="small"
            onClick={() =>
              setSetting((o) =>
                o?.layout !== "table"
                  ? { ...o, layout: "table" }
                  : { ...o, layout: "list" },
              )
            }>
            {isTableLayout ? (
              <span title={t("List View")}>
                <TableRowsRounded fontSize="inherit" />
              </span>
            ) : (
              <span title={t("Table View")}>
                <TableChartRounded fontSize="inherit" />
              </span>
            )}
          </IconButton>

          <Button size="small" variant="contained" onClick={onCloseAll}>
            <span style={{ whiteSpace: "nowrap" }}>
              {t("Close All")} {filterConn.length}
            </span>
          </Button>
        </Box>
      }>
      <Box
        sx={{
          mb: "10px",
          pt: "10px",
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          userSelect: "text",
          boxSizing: "border-box",
        }}>
        {!isTableLayout && (
          <BaseStyledSelect
            value={curOrderOpt}
            onChange={(e) => setOrderOpt(e.target.value)}>
            {Object.keys(orderOpts).map((opt) => (
              <MenuItem key={opt} value={opt}>
                <span style={{ fontSize: 14 }}>{t(opt)}</span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
      </Box>

      <Box
        height="calc(100% - 50px)"
        sx={(theme) => ({
          userSelect: "text",
          mx: "10px",
          mb: "4px",
          borderRadius: "8px",
          bgcolor: "#ffffff",
          ...theme.applyStyles("dark", {
            bgcolor: "#282a36",
          }),
          boxSizing: "border-box",
        })}>
        {filterConn.length === 0 ? (
          <BaseEmpty text={t("No Connections")} />
        ) : isTableLayout ? (
          <ConnectionTable
            connections={filterConn}
            onShowDetail={(detail) => detailRef.current?.open(detail)}
          />
        ) : (
          <Virtuoso
            data={filterConn}
            itemContent={(_, item) => (
              <ConnectionItem
                value={item}
                onShowDetail={() => detailRef.current?.open(item)}
              />
            )}
          />
        )}
      </Box>
      <ConnectionDetail ref={detailRef} />
    </BasePage>
  );
};

export default ConnectionsPage;
