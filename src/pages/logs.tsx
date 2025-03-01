import { useMemo, useState } from "react";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "foxact/use-local-storage";

import {
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
} from "@mui/icons-material";
import { LogLevel, clearLogs } from "@/hooks/use-log-data";
import { useClashInfo } from "@/hooks/use-clash";
import { useEnableLog } from "@/services/states";
import { BaseEmpty, BasePage } from "@/components/base";
import LogItem from "@/components/log/log-item";
import { useTheme } from "@mui/material/styles";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { BaseStyledSelect } from "@/components/base/base-styled-select";
import { SearchState } from "@/components/base/base-search-box";
import {
  useGlobalLogData,
  clearGlobalLogs,
  changeLogLevel,
  toggleLogEnabled,
} from "@/services/global-log-service";

const LogPage = () => {
  const { t } = useTranslation();
  const [enableLog, setEnableLog] = useEnableLog();
  const { clashInfo } = useClashInfo();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const [logLevel, setLogLevel] = useLocalStorage<LogLevel>(
    "log:log-level",
    "info",
  );
  const [match, setMatch] = useState(() => (_: string) => true);
  const logData = useGlobalLogData(logLevel);
  const [searchState, setSearchState] = useState<SearchState>();

  const filterLogs = useMemo(() => {
    return logData
      ? logData.filter((data) => {
          // 构建完整的搜索文本，包含时间、类型和内容
          const searchText =
            `${data.time || ""} ${data.type} ${data.payload}`.toLowerCase();

          return logLevel === "all"
            ? match(searchText)
            : data.type.toLowerCase() === logLevel && match(searchText);
        })
      : [];
  }, [logData, logLevel, match]);

  const handleLogLevelChange = (newLevel: LogLevel) => {
    setLogLevel(newLevel);
    if (clashInfo) {
      const { server = "", secret = "" } = clashInfo;
      changeLogLevel(newLevel, server, secret);
    }
  };

  const handleToggleLog = () => {
    if (clashInfo) {
      const { server = "", secret = "" } = clashInfo;
      toggleLogEnabled(server, secret);
      setEnableLog(!enableLog);
    }
  };

  return (
    <BasePage
      full
      title={t("Logs")}
      contentStyle={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton
            title={t("Pause")}
            size="small"
            color="inherit"
            onClick={handleToggleLog}
          >
            {enableLog ? (
              <PauseCircleOutlineRounded />
            ) : (
              <PlayCircleOutlineRounded />
            )}
          </IconButton>

          {enableLog === true && (
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                clearGlobalLogs();
              }}
            >
              {t("Clear")}
            </Button>
          )}
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
        }}
      >
        <BaseStyledSelect
          value={logLevel}
          onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
        >
          <MenuItem value="all">ALL</MenuItem>
          <MenuItem value="info">INFO</MenuItem>
          <MenuItem value="warning">WARNING</MenuItem>
          <MenuItem value="error">ERROR</MenuItem>
          <MenuItem value="debug">DEBUG</MenuItem>
        </BaseStyledSelect>
        <BaseSearchBox
          onSearch={(matcher, state) => {
            setMatch(() => matcher);
            setSearchState(state);
          }}
        />
      </Box>

      {filterLogs.length > 0 ? (
        <Virtuoso
          initialTopMostItemIndex={999}
          data={filterLogs}
          style={{
            flex: 1,
          }}
          itemContent={(index, item) => (
            <LogItem value={item} searchState={searchState} />
          )}
          followOutput={"smooth"}
        />
      ) : (
        <BaseEmpty />
      )}
    </BasePage>
  );
};

export default LogPage;
