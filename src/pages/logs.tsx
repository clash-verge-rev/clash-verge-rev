import { useMemo, useState } from "react";
import { useRecoilState } from "recoil";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
} from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import {
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
} from "@mui/icons-material";
import { atomEnableLog, atomLogData } from "@/services/states";
import BasePage from "@/components/base/base-page";
import BaseEmpty from "@/components/base/base-empty";
import LogItem from "@/components/log/log-item";

const LogPage = () => {
  const { t } = useTranslation();
  const [logData, setLogData] = useRecoilState(atomLogData);
  const [enableLog, setEnableLog] = useRecoilState(atomEnableLog);

  const [logState, setLogState] = useState("all");
  const [filterText, setFilterText] = useState("");

  const filterLogs = useMemo(() => {
    return logData.filter((data) => {
      return (
        data.payload.includes(filterText) &&
        (logState === "all" ? true : data.type.includes(logState))
      );
    });
  }, [logData, logState, filterText]);

  return (
    <BasePage
      title={t("Logs")}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ mt: 1, display: "flex", alignItems: "center" }}>
          <IconButton
            size="small"
            sx={{ mr: 2 }}
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
      <Paper sx={{ boxSizing: "border-box", boxShadow: 2, height: "100%" }}>
        <Box
          sx={{
            pt: 1,
            mb: 0.5,
            mx: "12px",
            height: "36px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Select
            size="small"
            autoComplete="off"
            value={logState}
            onChange={(e) => setLogState(e.target.value)}
            sx={{ width: 120, mr: 1, '[role="button"]': { py: 0.65 } }}
          >
            <MenuItem value="all">ALL</MenuItem>
            <MenuItem value="info">INFO</MenuItem>
            <MenuItem value="warn">WARN</MenuItem>
          </Select>

          <TextField
            hiddenLabel
            fullWidth
            size="small"
            autoComplete="off"
            variant="outlined"
            placeholder={t("Filter conditions")}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            sx={{ input: { py: 0.65, px: 1.25 } }}
          />
        </Box>

        <Box height="calc(100% - 50px)">
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
      </Paper>
    </BasePage>
  );
};

export default LogPage;
