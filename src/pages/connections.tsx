import {
  Clear,
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
import { useConnectionSetting } from "@/services/states";
import parseTraffic from "@/utils/parse-traffic";

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const [match, setMatch] = useState<(input: string) => boolean>(
    () => () => true,
  );
  const [curOrderOpt, setCurOrderOpt] = useState("Default");
  const [connectionsType, setConnectionsType] = useState<"active" | "closed">(
    "active",
  );

  const {
    response: { data: connections },
    clearClosedConnections,
  } = useConnectionData();

  const [setting, setSetting] = useConnectionSetting();

  const isTableLayout = setting.layout === "table";

  const orderOpts = useMemo<Record<string, OrderFunc>>(
    () => ({
      Default: (list) =>
        list.sort(
          (a, b) =>
            new Date(b.start || "0").getTime()! -
            new Date(a.start || "0").getTime()!,
        ),
      "Upload Speed": (list) =>
        list.sort((a, b) => b.curUpload! - a.curUpload!),
      "Download Speed": (list) =>
        list.sort((a, b) => b.curDownload! - a.curDownload!),
    }),
    [],
  );

  const [filterConn] = useMemo(() => {
    const orderFunc = orderOpts[curOrderOpt];
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
  }, [connections, connectionsType, match, curOrderOpt, orderOpts]);

  const onCloseAll = useLockFn(closeAllConnections);

  const detailRef = useRef<ConnectionDetailRef>(null!);

  const handleSearch = useCallback((match: (content: string) => boolean) => {
    setMatch(() => match);
  }, []);

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
            {t("Downloaded")}: {parseTraffic(connections?.downloadTotal)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("Uploaded")}: {parseTraffic(connections?.uploadTotal)}
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
        <ButtonGroup sx={{ mr: 1, flexBasis: "content" }}>
          <Button
            size="small"
            variant={connectionsType === "active" ? "contained" : "outlined"}
            onClick={() => setConnectionsType("active")}
          >
            {t("Active")} {connections?.activeConnections.length}
          </Button>
          <Button
            size="small"
            variant={connectionsType === "closed" ? "contained" : "outlined"}
            onClick={() => setConnectionsType("closed")}
          >
            {t("Closed")} {connections?.closedConnections.length}
          </Button>
        </ButtonGroup>
        {!isTableLayout && (
          <BaseStyledSelect
            value={curOrderOpt}
            onChange={(e) => setCurOrderOpt(e.target.value)}
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
      {connectionsType === "closed" && (
        <Fab
          variant="extended"
          sx={{ position: "absolute", right: 16, bottom: 16 }}
          color="primary"
          onClick={() => clearClosedConnections()}
        >
          <Clear sx={{ mr: 1 }} />
          {t("Clear")}
        </Fab>
      )}
    </BasePage>
  );
};

export default ConnectionsPage;
