import {
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
} from "@mui/icons-material";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

import { BaseEmpty, BasePage } from "@/components/base";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { SearchState } from "@/components/base/base-search-box";
import { BaseStyledSelect } from "@/components/base/base-styled-select";
import LogItem from "@/components/log/log-item";
import { useLogData } from "@/hooks/use-log-data";
import { LogFilter, useClashLog } from "@/services/states";

const LogPage = () => {
  const { t } = useTranslation();
  const [clashLog, setClashLog] = useClashLog();
  const enableLog = clashLog.enable;
  const logState = clashLog.logFilter;

  const [match, setMatch] = useState(() => (_: string) => true);
  const [searchState, setSearchState] = useState<SearchState>();
  const {
    response: { data: logData },
    refreshGetClashLog,
  } = useLogData();

  const filterLogs = useMemo(() => {
    if (!logData || logData.length === 0) {
      return [];
    }

    // Server-side filtering handles level filtering via query parameters
    // We only need to apply search filtering here
    return logData.filter((data) => {
      // 构建完整的搜索文本，包含时间、类型和内容
      const searchText =
        `${data.time || ""} ${data.type} ${data.payload}`.toLowerCase();

      const matchesSearch = match(searchText);

      return (
        (logState == "all" ? true : data.type.includes(logState)) &&
        matchesSearch
      );
    });
  }, [logData, logState, match]);

  const handleLogLevelChange = (newLevel: string) => {
    setClashLog((pre: any) => ({ ...pre, logFilter: newLevel }));
  };

  const handleToggleLog = async () => {
    setClashLog((pre: any) => ({ ...pre, enable: !enableLog }));
  };

  return (
    <BasePage
      full
      title={t("logs.page.title")}
      contentStyle={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton
            title={t(
              enableLog ? "shared.actions.pause" : "shared.actions.resume",
            )}
            aria-label={t(
              enableLog ? "shared.actions.pause" : "shared.actions.resume",
            )}
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

          <Button
            size="small"
            variant="contained"
            onClick={() => {
              refreshGetClashLog(true);
            }}
          >
            {t("shared.actions.clear")}
          </Button>
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
          value={logState}
          onChange={(e) => handleLogLevelChange(e.target.value as LogFilter)}
        >
          <MenuItem value="all">{t("shared.filters.logLevels.all")}</MenuItem>
          <MenuItem value="debug">
            {t("shared.filters.logLevels.debug")}
          </MenuItem>
          <MenuItem value="info">{t("shared.filters.logLevels.info")}</MenuItem>
          <MenuItem value="warn">{t("shared.filters.logLevels.warn")}</MenuItem>
          <MenuItem value="err">{t("shared.filters.logLevels.error")}</MenuItem>
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
