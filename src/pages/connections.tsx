import { useMemo, useRef, useState, useCallback } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import {
  TableChartRounded,
  TableRowsRounded,
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
} from "@mui/icons-material";
import { closeAllConnections } from "@/services/api";
import { useConnectionSetting } from "@/services/states";
import { useClashInfo } from "@/hooks/use-clash";
import { BaseEmpty, BasePage } from "@/components/base";
import { ConnectionItem } from "@/components/connection/connection-item";
import { ConnectionTable } from "@/components/connection/connection-table";
import {
  ConnectionDetail,
  ConnectionDetailRef,
} from "@/components/connection/connection-detail";
import parseTraffic from "@/utils/parse-traffic";
import {
  BaseSearchBox,
  type SearchState,
} from "@/components/base/base-search-box";
import { BaseStyledSelect } from "@/components/base/base-styled-select";
import useSWRSubscription from "swr/subscription";
import { createSockette } from "@/utils/websocket";
import { useTheme } from "@mui/material/styles";
import { useVisibility } from "@/hooks/use-visibility";

const initConn: IConnections = {
  uploadTotal: 0,
  downloadTotal: 0,
  connections: [],
};

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const pageVisible = useVisibility();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
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

  const [isPaused, setIsPaused] = useState(false);
  const [frozenData, setFrozenData] = useState<IConnections | null>(null);

  const { data: connData = initConn } = useSWRSubscription<
    IConnections,
    any,
    "getClashConnections" | null
  >(
    clashInfo && pageVisible ? "getClashConnections" : null,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;
      const s = createSockette(
        `ws://${server}/connections?token=${encodeURIComponent(secret)}`,
        {
          onmessage(event) {
            const data = JSON.parse(event.data) as IConnections;
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
        s.close();
      };
    },
  );

  const displayData = useMemo(() => {
    return isPaused ? (frozenData ?? connData) : connData;
  }, [isPaused, frozenData, connData]);

  const [filterConn, download, upload] = useMemo(() => {
    const orderFunc = orderOpts[curOrderOpt];

    let connections = displayData.connections.filter((conn) => {
      const { host, destinationIP, process } = conn.metadata;
      return (
        match(host || "") || match(destinationIP || "") || match(process || "")
      );
    });

    if (orderFunc) connections = orderFunc(connections);

    let download = 0;
    let upload = 0;
    connections.forEach((x) => {
      download += x.download;
      upload += x.upload;
    });
    return [connections, download, upload];
  }, [displayData, match, curOrderOpt]);

  const onCloseAll = useLockFn(closeAllConnections);

  const detailRef = useRef<ConnectionDetailRef>(null!);

  const handleSearch = useCallback((match: (content: string) => boolean) => {
    setMatch(() => match);
  }, []);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => {
      if (!prev) {
        setFrozenData(connData);
      } else {
        setFrozenData(null);
      }
      return !prev;
    });
  }, [connData]);

  return (
    <BasePage
      full
      title={<span style={{ whiteSpace: "nowrap" }}>{t("Connections")}</span>}
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
            {t("Downloaded")}: {parseTraffic(download)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("Uploaded")}: {parseTraffic(upload)}
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
              <TableRowsRounded titleAccess={t("List View")} />
            ) : (
              <TableChartRounded titleAccess={t("Table View")} />
            )}
          </IconButton>
          <IconButton
            color="inherit"
            size="small"
            onClick={handlePauseToggle}
            title={isPaused ? t("Resume") : t("Pause")}
          >
            {isPaused ? (
              <PlayCircleOutlineRounded />
            ) : (
              <PauseCircleOutlineRounded />
            )}
          </IconButton>
          <Button size="small" variant="contained" onClick={onCloseAll}>
            <span style={{ whiteSpace: "nowrap" }}>{t("Close All")}</span>
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
            onChange={(e) => setOrderOpt(e.target.value)}
          >
            {Object.keys(orderOpts).map((opt) => (
              <MenuItem key={opt} value={opt}>
                <span style={{ fontSize: 14 }}>{t(opt)}</span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        <BaseSearchBox onSearch={handleSearch} />
      </Box>

      {filterConn.length === 0 ? (
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
