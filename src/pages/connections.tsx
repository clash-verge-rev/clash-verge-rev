import {
  PauseCircleOutlineRounded,
  PlayCircleOutlineRounded,
  TableChartRounded,
  TableRowsRounded,
} from "@mui/icons-material";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
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
import { useVisibility } from "@/hooks/use-visibility";
import { useConnectionSetting } from "@/services/states";
import parseTraffic from "@/utils/parse-traffic";

const initConn: IConnections = {
  uploadTotal: 0,
  downloadTotal: 0,
  connections: [],
};

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ORDER_OPTIONS = [
  {
    id: "default",
    labelKey: "connections.order.default",
    fn: (list: IConnectionsItem[]) =>
      list.sort(
        (a, b) =>
          new Date(b.start || "0").getTime()! -
          new Date(a.start || "0").getTime()!,
      ),
  },
  {
    id: "uploadSpeed",
    labelKey: "connections.order.uploadSpeed",
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => b.curUpload! - a.curUpload!),
  },
  {
    id: "downloadSpeed",
    labelKey: "connections.order.downloadSpeed",
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
  const pageVisible = useVisibility();
  const [match, setMatch] = useState<(input: string) => boolean>(
    () => () => true,
  );
  const [curOrderOpt, setCurOrderOpt] = useState<OrderKey>("default");

  const {
    response: { data: connections },
  } = useConnectionData();

  const [setting, setSetting] = useConnectionSetting();

  const isTableLayout = setting.layout === "table";

  const [isPaused, setIsPaused] = useState(false);
  const [frozenData, setFrozenData] = useState<IConnections | null>(null);

  // 使用全局连接数据
  const displayData = useMemo(() => {
    if (!pageVisible) return initConn;

    if (isPaused) {
      return (
        frozenData ?? {
          uploadTotal: connections?.uploadTotal,
          downloadTotal: connections?.downloadTotal,
          connections: connections?.connections,
        }
      );
    }

    return {
      uploadTotal: connections?.uploadTotal,
      downloadTotal: connections?.downloadTotal,
      connections: connections?.connections,
    };
  }, [isPaused, frozenData, connections, pageVisible]);

  const [filterConn] = useMemo(() => {
    const orderFunc = orderFunctionMap[curOrderOpt];
    let conns = displayData.connections?.filter((conn) => {
      const { host, destinationIP, process } = conn.metadata;
      return (
        match(host || "") || match(destinationIP || "") || match(process || "")
      );
    });

    if (orderFunc) conns = orderFunc(conns ?? []);

    return [conns];
  }, [displayData, match, curOrderOpt]);

  const onCloseAll = useLockFn(closeAllConnections);

  const detailRef = useRef<ConnectionDetailRef>(null!);

  const handleSearch = useCallback((match: (content: string) => boolean) => {
    setMatch(() => match);
  }, []);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => {
      if (!prev) {
        setFrozenData({
          uploadTotal: connections?.uploadTotal ?? 0,
          downloadTotal: connections?.downloadTotal ?? 0,
          connections: connections?.connections ?? [],
        });
      } else {
        setFrozenData(null);
      }
      return !prev;
    });
  }, [connections]);

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
        overflow: "auto",
        borderRadius: "8px",
      }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ mx: 1 }}>
            {t("connections.page.summary.downloaded")}:{" "}
            {parseTraffic(displayData.downloadTotal)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("connections.page.summary.uploaded")}:{" "}
            {parseTraffic(displayData.uploadTotal)}
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
              <TableRowsRounded
                titleAccess={t("connections.page.actions.listView")}
              />
            ) : (
              <TableChartRounded
                titleAccess={t("connections.page.actions.tableView")}
              />
            )}
          </IconButton>
          <IconButton
            color="inherit"
            size="small"
            onClick={handlePauseToggle}
            title={
              isPaused
                ? t("connections.page.actions.resume")
                : t("connections.page.actions.pause")
            }
          >
            {isPaused ? (
              <PlayCircleOutlineRounded />
            ) : (
              <PauseCircleOutlineRounded />
            )}
          </IconButton>
          <Button size="small" variant="contained" onClick={onCloseAll}>
            <span style={{ whiteSpace: "nowrap" }}>
              {t("connections.page.actions.closeAll")}
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
          height: "36px",
          display: "flex",
          alignItems: "center",
          userSelect: "text",
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
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
        <BaseSearchBox onSearch={handleSearch} />
      </Box>

      {!filterConn || filterConn.length === 0 ? (
        <BaseEmpty />
      ) : isTableLayout ? (
        <ConnectionTable
          connections={filterConn}
          onShowDetail={(detail) => detailRef.current?.open(detail)}
        />
      ) : (
        <Virtuoso
          style={{
            flex: 1,
            borderRadius: "8px",
          }}
          data={filterConn}
          itemContent={(_, item) => (
            <ConnectionItem
              value={item}
              onShowDetail={() => detailRef.current?.open(item)}
            />
          )}
        />
      )}
      <ConnectionDetail ref={detailRef} />
    </BasePage>
  );
};

export default ConnectionsPage;
