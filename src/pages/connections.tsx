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
import { initConnData, useConnectionData } from "@/hooks/use-connection-data";
import { useConnectionSetting } from "@/services/states";
import parseTraffic from "@/utils/parse-traffic";
import {
  Download,
  TableChartRounded,
  TableRowsRounded,
  Upload,
} from "@mui/icons-material";
import {
  Box,
  Button,
  ButtonGroup,
  IconButton,
  MenuItem,
  Tooltip,
} from "@mui/material";
import { useGridApiRef } from "@mui/x-data-grid";
import { useLockFn } from "ahooks";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { closeAllConnections, closeConnections } from "tauri-plugin-mihomo-api";

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];
const MAX_CLOSED_CONNS = 500;

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const [match, setMatch] = useState(() => (_: string) => true);
  const [curOrderOpt, setOrderOpt] = useState("Default");
  const [tabName, setTabName] = useState<"active" | "closed">("active");
  const [setting, setSetting] = useConnectionSetting();
  const gridApiRef = useGridApiRef();

  const isTableLayout = setting.layout === "table";
  const isActiveTab = tabName === "active";

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

  const {
    response: { data: connData = initConnData },
  } = useConnectionData();
  const [activeConns, setActiveConns] = useState<IConnectionsItem[]>([]);
  const [closedConns, setClosedConns] = useState<IConnectionsItem[]>([]);

  const detailRef = useRef<ConnectionDetailRef>(null!);
  const totalUpload = parseTraffic(connData.uploadTotal);
  const totalDownload = parseTraffic(connData.downloadTotal);

  useEffect(() => {
    const ids = connData.connections.map((o) => o.id);
    const closed = activeConns.filter((o) => !ids.includes(o.id));
    let newList = [...closedConns, ...closed];
    if (newList.length > MAX_CLOSED_CONNS) {
      newList = newList.slice(-Math.min(MAX_CLOSED_CONNS, newList.length));
    }
    setClosedConns(newList);
    setActiveConns(connData.connections);
  }, [connData]);

  // filter connections
  const orderFunc = orderOpts[curOrderOpt];
  const conns = isActiveTab ? activeConns : closedConns;
  let filterConn = conns.filter((conn) =>
    match(conn.metadata.host || conn.metadata.destinationIP || ""),
  );
  if (orderFunc) filterConn = orderFunc(filterConn);

  const onCloseAll = useLockFn(async () => {
    if (!isActiveTab || filterConn.length === connData.connections.length) {
      await closeAllConnections();
    } else {
      filterConn.forEach(async (conn) => await closeConnections(conn.id));
    }
  });

  return (
    <BasePage
      full
      title={<span style={{ whiteSpace: "nowrap" }}>{t("Connections")}</span>}
      contentStyle={{ height: "100%" }}
      header={
        <div className="mx-2 flex items-center overflow-hidden">
          <div className="flex w-full items-center space-x-2 p-2">
            <div className="flex w-fit items-center space-x-4">
              <div className="flex w-full items-center space-x-1">
                <Tooltip title={t("Total Uploaded")}>
                  <Upload fontSize="small" />
                </Tooltip>
                <span className="text-sm">{totalUpload[0]}</span>
                <span className="text-sm">{totalUpload[1]}</span>
              </div>
              <div className="flex w-full items-center space-x-1">
                <Tooltip title={t("Total Downloaded")}>
                  <Download fontSize="small" />
                </Tooltip>
                <span className="text-sm">{totalDownload[0]}</span>
                <span className="text-sm">{totalDownload[1]}</span>
              </div>
            </div>
            <IconButton
              color="inherit"
              size="small"
              title={isTableLayout ? t("List View") : t("Table View")}
              onClick={() =>
                setSetting((o) =>
                  o?.layout !== "table"
                    ? { ...o, layout: "table" }
                    : { ...o, layout: "list" },
                )
              }>
              {isTableLayout ? (
                <TableRowsRounded fontSize="inherit" />
              ) : (
                <TableChartRounded fontSize="inherit" />
              )}
            </IconButton>
          </div>
          <div>
            <Button size="small" variant="contained" onClick={onCloseAll}>
              <span style={{ whiteSpace: "nowrap" }}>
                {t("Close All")}{" "}
                {isActiveTab ? filterConn.length : activeConns.length}
              </span>
            </Button>
          </div>
        </div>
      }>
      <div className="h-full w-full overflow-hidden">
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
          <ButtonGroup size="small" className="mr-2 w-fit shrink-0 grow-0">
            <Button
              variant={isActiveTab ? "contained" : "outlined"}
              onClick={() => {
                setTabName("active");
                gridApiRef.current.scroll({ top: 0 });
              }}>
              {t("Active")} {activeConns.length}
            </Button>
            <Button
              variant={!isActiveTab ? "contained" : "outlined"}
              onClick={() => {
                setTabName("closed");
                gridApiRef.current.scroll({ top: 0 });
              }}>
              {t("Closed")} {closedConns.length}
            </Button>
          </ButtonGroup>
          {!isTableLayout && isActiveTab && (
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
              gridApiRef={gridApiRef}
              connections={filterConn}
              onShowDetail={(detail) =>
                detailRef.current?.open(detail, isActiveTab)
              }
            />
          ) : (
            <Virtuoso
              data={filterConn}
              itemContent={(_, item) => (
                <ConnectionItem
                  key={item.id}
                  value={item}
                  onShowDetail={() =>
                    detailRef.current?.open(item, isActiveTab)
                  }
                />
              )}
            />
          )}
        </Box>
        <ConnectionDetail ref={detailRef} />
      </div>
    </BasePage>
  );
};

export default ConnectionsPage;
