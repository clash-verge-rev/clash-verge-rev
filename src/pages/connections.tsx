import { useMemo, useRef, useState, useCallback } from "react";
import { useLockFn } from "ahooks";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
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
import { useTheme } from "@mui/material/styles";
import { useVisibility } from "@/hooks/use-visibility";
import { useAppData } from "@/providers/app-data-provider";

const initConn: IConnections = {
  uploadTotal: 0,
  downloadTotal: 0,
  connections: [],
};

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const pageVisible = useVisibility();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const [match, setMatch] = useState(() => (_: string) => true);
  const [curOrderOpt, setOrderOpt] = useState("Default");
  const [activeFilter, setActiveFilter] = useState<
    "active" | "inactive" | "all"
  >("all");

  // 使用全局数据
  const { connections } = useAppData();

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
    // 新增排序方式
    下载量: (list) =>
      list.sort((a, b) => (b.download ?? 0) - (a.download ?? 0)),
    上传量: (list) => list.sort((a, b) => (b.upload ?? 0) - (a.upload ?? 0)),
  };

  const [isPaused, setIsPaused] = useState(false);
  const [frozenData, setFrozenData] = useState<IConnections | null>(null);

  // 使用全局连接数据
  const displayData = useMemo(() => {
    if (!pageVisible) return initConn;

    if (isPaused) {
      return (
        frozenData ?? {
          uploadTotal: connections.uploadTotal,
          downloadTotal: connections.downloadTotal,
          connections: connections.data,
        }
      );
    }

    return {
      uploadTotal: connections.uploadTotal,
      downloadTotal: connections.downloadTotal,
      connections: connections.data,
    };
  }, [isPaused, frozenData, connections, pageVisible]);

  const [filterConn] = useMemo(() => {
    const orderFunc = orderOpts[curOrderOpt];
    let conns = displayData.connections.filter((conn) => {
      const { host, destinationIP, process } = conn.metadata;
      let matchResult =
        match(host || "") || match(destinationIP || "") || match(process || "");
      if (activeFilter === "active") {
        matchResult =
          matchResult &&
          ((conn.curUpload && conn.curUpload > 0) ||
            (conn.curDownload && conn.curDownload > 0));
      } else if (activeFilter === "inactive") {
        matchResult = matchResult && !conn.curUpload && !conn.curDownload;
      }
      return matchResult;
    });

    if (orderFunc) conns = orderFunc(conns);

    return [conns];
  }, [displayData, match, curOrderOpt, activeFilter]);

  const onCloseAll = useLockFn(closeAllConnections);

  const detailRef = useRef<ConnectionDetailRef>(null!);

  const handleSearch = useCallback((match: (content: string) => boolean) => {
    setMatch(() => match);
  }, []);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => {
      if (!prev) {
        setFrozenData({
          uploadTotal: connections.uploadTotal,
          downloadTotal: connections.downloadTotal,
          connections: connections.data,
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
          {/* 替换 ToggleButtonGroup 为 Button 组件 */}
          <Button
            size="small"
            variant={activeFilter === "active" ? "contained" : "outlined"}
            color={activeFilter === "active" ? "primary" : "inherit"}
            onClick={() =>
              setActiveFilter(activeFilter === "active" ? "all" : "active")
            }
            sx={{ minWidth: 64 }}
          >
            {t("活动")}
          </Button>
          <Button
            size="small"
            variant={activeFilter === "inactive" ? "contained" : "outlined"}
            color={activeFilter === "inactive" ? "primary" : "inherit"}
            onClick={() =>
              setActiveFilter(activeFilter === "inactive" ? "all" : "inactive")
            }
            sx={{ minWidth: 64 }}
          >
            {t("未活动")}
          </Button>
          <Box sx={{ mx: 1 }}>
            {t("Downloaded")}: {parseTraffic(displayData.downloadTotal)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("Uploaded")}: {parseTraffic(displayData.uploadTotal)}
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
