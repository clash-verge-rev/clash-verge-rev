import { useMemo, useState } from "react";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "foxact/use-local-storage";

import {
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
} from "@mui/icons-material";
import { LogLevel } from "@/hooks/use-log-data";
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

// 定义日志级别结构 - 与后端保持一致
// 后端顺序：Debug < Info < Warning < Error, All 显示所有
const LOG_LEVEL_HIERARCHY = {
  all: ["debug", "info", "warning", "error"], // All: 显示所有等级
  debug: ["debug", "info", "warning", "error"], // Debug: 显示所有等级（最低级别）
  info: ["info", "warning", "error"], // Info: 显示 Info、Warning、Error
  warning: ["warning", "error"], // Warning: 显示 Warning、Error
  error: ["error"], // Error: 仅显示 Error
};

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
  const logData = useGlobalLogData("all");
  const [searchState, setSearchState] = useState<SearchState>();

  const filterLogs = useMemo(() => {
    if (!logData || logData.length === 0) {
      return [];
    }

    const allowedTypes = LOG_LEVEL_HIERARCHY[logLevel] || [];

    return logData.filter((data) => {
      const logType = data.type?.toLowerCase() || "";
      const isAllowedType =
        logLevel === "all" || allowedTypes.includes(logType);

      // 构建完整的搜索文本，包含时间、类型和内容
      const searchText =
        `${data.time || ""} ${data.type} ${data.payload}`.toLowerCase();

      const matchesSearch = match(searchText);

      return isAllowedType && matchesSearch;
    });
  }, [logData, logLevel, match]);

  const handleLogLevelChange = (newLevel: LogLevel) => {
    setLogLevel(newLevel);
    changeLogLevel(newLevel);
  };

  const handleToggleLog = async () => {
    await toggleLogEnabled();
    setEnableLog(!enableLog);
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
            title={t(enableLog ? "Pause" : "Resume")}
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
          height: "39px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <BaseStyledSelect
          value={logLevel}
          onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
        >
          <MenuItem value="all">ALL</MenuItem>
          <MenuItem value="debug">DEBUG</MenuItem>
          <MenuItem value="info">INFO</MenuItem>
          <MenuItem value="warning">WARNING</MenuItem>
          <MenuItem value="error">ERROR</MenuItem>
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
