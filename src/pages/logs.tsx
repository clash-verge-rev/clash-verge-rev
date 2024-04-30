import { useMemo, useState } from "react";
import { useRecoilState } from "recoil";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Select,
  SelectProps,
  styled,
} from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import {
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
} from "@mui/icons-material";
import { atomEnableLog, atomLogData } from "@/services/states";
import { BaseEmpty, BasePage } from "@/components/base";
import LogItem from "@/components/log/log-item";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";

const StyledSelect = styled((props: SelectProps<string>) => {
  return (
    <Select
      size="small"
      autoComplete="off"
      sx={{
        width: 120,
        height: 33.375,
        mr: 1,
        '[role="button"]': { py: 0.65 },
      }}
      {...props}
    />
  );
})(({ theme }) => ({
  background: theme.palette.mode === "light" ? "#fff" : undefined,
}));

const LogPage = () => {
  const { t } = useTranslation();
  const [logData, setLogData] = useRecoilState(atomLogData);
  const [enableLog, setEnableLog] = useRecoilState(atomEnableLog);
  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const [logState, setLogState] = useState("all");
  const [filterText, setFilterText] = useState("");
  const [useRegexSearch, setUseRegexSearch] = useState(true);
  const [hasInputError, setInputError] = useState(false);
  const [inputHelperText, setInputHelperText] = useState("");
  const filterLogs = useMemo(() => {
    setInputHelperText("");
    setInputError(false);
    if (useRegexSearch) {
      try {
        const regex = new RegExp(filterText);
        return logData.filter((data) => {
          return (
            regex.test(data.payload) &&
            (logState === "all" ? true : data.type.includes(logState))
          );
        });
      } catch (err: any) {
        setInputHelperText(err.message.substring(0, 60));
        setInputError(true);
        return logData;
      }
    }
    return logData.filter((data) => {
      return (
        data.payload.includes(filterText) &&
        (logState === "all" ? true : data.type.includes(logState))
      );
    });
  }, [logData, logState, filterText]);

  return (
    <BasePage
      full
      title={t("Logs")}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton
            size="small"
            color="inherit"
            onClick={() => setEnableLog((e) => !e)}
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
            onClick={() => setLogData([])}
          >
            {t("Clear")}
          </Button>
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          height: "48px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <StyledSelect
          value={logState}
          onChange={(e) => setLogState(e.target.value)}
        >
          <MenuItem value="all">ALL</MenuItem>
          <MenuItem value="inf">INFO</MenuItem>
          <MenuItem value="warn">WARN</MenuItem>
          <MenuItem value="err">ERROR</MenuItem>
        </StyledSelect>

        <BaseStyledTextField
          error={hasInputError}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          helperText={inputHelperText}
          placeholder={t("Filter conditions")}
          InputProps={{
            sx: { pr: 1 },
            endAdornment: (
              <IconButton
                sx={{ p: 0.5 }}
                title={t("Use Regular Expression")}
                style={{
                  backgroundColor: useRegexSearch
                    ? "rgba(20, 20, 20, 0.2)"
                    : "rgba(30, 0, 0, 0.0)",
                  fontSize: "150%",
                  fontWeight: "800",
                  borderRadius: "10%",
                }}
                onClick={() => setUseRegexSearch(!useRegexSearch)}
              >
                .*
              </IconButton>
            ),
          }}
        />
      </Box>

      <Box
        height="calc(100% - 65px)"
        sx={{
          margin: "10px",
          borderRadius: "8px",
          bgcolor: isDark ? "#282a36" : "#ffffff",
        }}
      >
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
