import {
  DeleteForeverRounded,
  TableChartRounded,
  TableRowsRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  ButtonGroup,
  Fab,
  IconButton,
  MenuItem,
  Zoom,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { closeAllConnections } from "tauri-plugin-mihomo-api";

import { BaseEmpty, BasePage } from "@/components/base";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { BaseStyledSelect } from "@/components/base/base-styled-select";
import {
  ConnectionDetail,
  ConnectionDetailRef,
} from "@/components/connection/connection-detail";
import { ConnectionItem } from "@/components/connection/connection-item";
import { ConnectionTable } from "@/components/connection/connection-table";
import { useConnectionData } from "@/hooks/use-connection-data";
import { useConnectionSetting } from "@/hooks/use-connection-setting";
import parseTraffic from "@/utils/parse-traffic";

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ORDER_OPTIONS = [
  {
    id: "default",
    labelKey: "connections.components.order.default",
    fn: (list: IConnectionsItem[]) =>
      list.sort(
        (a, b) =>
          new Date(b.start || "0").getTime()! -
          new Date(a.start || "0").getTime()!,
      ),
  },
  {
    id: "uploadSpeed",
    labelKey: "connections.components.order.uploadSpeed",
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => b.curUpload! - a.curUpload!),
  },
  {
    id: "downloadSpeed",
    labelKey: "connections.components.order.downloadSpeed",
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => b.curDownload! - a.curDownload!),
  },
] as const;

type OrderKey = (typeof ORDER_OPTIONS)[number]["id"];

const orderFunctionMap = ORDER_OPTIONS.reduce<Record<OrderKey, OrderFunc>>(
  (acc, option) => {
    acc[option.id] = option.fn;
    return acc;
  },
  {} as Record<OrderKey, OrderFunc>,
);

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const [match, setMatch] = useState<(input: string) => boolean>(
    () => () => true,
  );
  const [curOrderOpt, setCurOrderOpt] = useState<OrderKey>("default");
  const [connectionsType, setConnectionsType] = useState<"active" | "closed">(
    "active",
  );

  const {
    response: { data: connections },
    clearClosedConnections,
  } = useConnectionData();

  const [setting, setSetting] = useConnectionSetting();

  const isTableLayout = setting.layout === "table";

  const [isColumnManagerOpen, setIsColumnManagerOpen] = useState(false);

  const [filterConn] = useMemo(() => {
    const orderFunc = orderFunctionMap[curOrderOpt];
    const conns =
      (connectionsType === "active"
        ? connections?.activeConnections
        : connections?.closedConnections) ?? [];
    let matchConns = conns.filter((conn) => {
      const { host, destinationIP, process } = conn.metadata;
      return (
        match(host || "") || match(destinationIP || "") || match(process || "")
      );
    });

    if (orderFunc) matchConns = orderFunc(matchConns ?? []);

    return [matchConns];
  }, [connections, connectionsType, match, curOrderOpt]);

  const onCloseAll = useLockFn(closeAllConnections);

  const detailRef = useRef<ConnectionDetailRef>(null!);

  const handleSearch = useCallback((match: (content: string) => boolean) => {
    setMatch(() => match);
  }, []);

  const hasTableData = filterConn.length > 0;

  return (
    <BasePage
      full
      title={
        <span style={{ whiteSpace: "nowrap" }}>
          {t("connections.page.title")}
        </span>
      }
      contentStyle={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: "8px",
        minHeight: 0,
      }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ mx: 1 }}>
            {t("shared.labels.downloaded")}:{" "}
            {parseTraffic(connections?.downloadTotal)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("shared.labels.uploaded")}:{" "}
            {parseTraffic(connections?.uploadTotal)}
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
            }
          >
            {isTableLayout ? (
              <TableRowsRounded titleAccess={t("shared.actions.listView")} />
            ) : (
              <TableChartRounded titleAccess={t("shared.actions.tableView")} />
            )}
          </IconButton>
          <Button size="small" variant="contained" onClick={onCloseAll}>
            <span style={{ whiteSpace: "nowrap" }}>
              {t("shared.actions.closeAll")}
            </span>
          </Button>
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          minHeight: "36px",
          display: "flex",
          alignItems: "center",
          gap: 1,
          userSelect: "text",
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <ButtonGroup sx={{ mr: 1, flexBasis: "content" }}>
          <Button
            size="small"
            variant={connectionsType === "active" ? "contained" : "outlined"}
            onClick={() => setConnectionsType("active")}
          >
            {t("connections.components.actions.active")}{" "}
            {connections?.activeConnections.length}
          </Button>
          <Button
            size="small"
            variant={connectionsType === "closed" ? "contained" : "outlined"}
            onClick={() => setConnectionsType("closed")}
          >
            {t("connections.components.actions.closed")}{" "}
            {connections?.closedConnections.length}
          </Button>
        </ButtonGroup>
        {!isTableLayout && (
          <BaseStyledSelect
            value={curOrderOpt}
            onChange={(e) => setCurOrderOpt(e.target.value as OrderKey)}
          >
            {ORDER_OPTIONS.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                <span style={{ fontSize: 14 }}>{t(option.labelKey)}</span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            "& > *": {
              flex: 1,
            },
          }}
        >
          <BaseSearchBox onSearch={handleSearch} />
        </Box>
      </Box>

      {!hasTableData ? (
        <BaseEmpty />
      ) : isTableLayout ? (
        <ConnectionTable
          connections={filterConn}
          onShowDetail={(detail) =>
            detailRef.current?.open(detail, connectionsType === "closed")
          }
          columnManagerOpen={isTableLayout && isColumnManagerOpen}
          onOpenColumnManager={() => setIsColumnManagerOpen(true)}
          onCloseColumnManager={() => setIsColumnManagerOpen(false)}
        />
      ) : (
        <Virtuoso
          style={{
            flex: 1,
            borderRadius: "8px",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
          data={filterConn}
          itemContent={(_, item) => (
            <ConnectionItem
              value={item}
              closed={connectionsType === "closed"}
              onShowDetail={() =>
                detailRef.current?.open(item, connectionsType === "closed")
              }
            />
          )}
        />
      )}
      <ConnectionDetail ref={detailRef} />
      <Zoom
        in={connectionsType === "closed" && filterConn.length > 0}
        unmountOnExit
      >
        <Fab
          size="medium"
          variant="extended"
          sx={{
            position: "absolute",
            right: 16,
            bottom: isTableLayout ? 70 : 16,
          }}
          color="primary"
          onClick={() => clearClosedConnections()}
        >
          <DeleteForeverRounded sx={{ mr: 1 }} fontSize="small" />
          {t("shared.actions.clear")}
        </Fab>
      </Zoom>
    </BasePage>
  );
};

export default ConnectionsPage;
