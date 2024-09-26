import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  BaseStyledSelect,
} from "@/components/base";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import LogItem from "@/components/log/log-item";
import { useLogData } from "@/hooks/use-log-data";
import { useEnableLog } from "@/services/states";
import {
  PauseCircleOutlineRounded,
  PlayCircleOutlineRounded,
} from "@mui/icons-material";
import { Box, Button, IconButton, MenuItem } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

const LogPage = () => {
  const { t } = useTranslation();
  const {
    getClashLogHook: { data: logData = [] },
    refreshGetClashLog,
  } = useLogData();
  const [enableLog, setEnableLog] = useEnableLog();
  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const [logState, setLogState] = useState("all");
  const [match, setMatch] = useState(() => (_: string) => true);

  const filterLogs = useMemo(() => {
    return logData.filter(
      (data) =>
        (logState === "all" ? true : data.type.includes(logState)) &&
        match(data.payload),
    );
  }, [logData, logState, match]);

  return (
    <BasePage
      full
      title={t("Logs")}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton
            title={t("Pause")}
            size="small"
            color="inherit"
            onClick={() => setEnableLog((e) => !e)}>
            {enableLog ? (
              <PauseCircleOutlineRounded />
            ) : (
              <PlayCircleOutlineRounded />
            )}
          </IconButton>

          <Button
            size="small"
            variant="contained"
            // useSWRSubscription adds a prefix "$sub$" to the cache key
            // https://github.com/vercel/swr/blob/1585a3e37d90ad0df8097b099db38f1afb43c95d/src/subscription/index.ts#L37
            onClick={() => refreshGetClashLog()}>
            {t("Clear")}
          </Button>
        </Box>
      }>
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
        }}>
        <BaseStyledSelect
          value={logState}
          onChange={(e) => setLogState(e.target.value)}>
          <MenuItem value="all">ALL</MenuItem>
          <MenuItem value="inf">INFO</MenuItem>
          <MenuItem value="warn">WARN</MenuItem>
          <MenuItem value="err">ERROR</MenuItem>
        </BaseStyledSelect>
        <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
      </Box>

      <Box
        height="calc(100% - 65px)"
        sx={{
          pt: 1,
          margin: "10px",
          borderRadius: "8px",
          bgcolor: isDark ? "#282a36" : "#ffffff",
        }}>
        {filterLogs.length > 0 ? (
          <Virtuoso
            initialTopMostItemIndex={999}
            data={filterLogs}
            itemContent={(index, item) => <LogItem value={item} />}
            followOutput={"smooth"}
          />
        ) : (
          <BaseEmpty text="No Logs" />
        )}
      </Box>
    </BasePage>
  );
};

export default LogPage;
