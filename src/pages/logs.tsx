import { useRecoilState } from "recoil";
import { Button, Paper } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { atomLogData } from "../services/states";
import BasePage from "../components/base/base-page";
import LogItem from "../components/log/log-item";

const LogPage = () => {
  const { t } = useTranslation();
  const [logData, setLogData] = useRecoilState(atomLogData);

  return (
    <BasePage
      title={t("Logs")}
      contentStyle={{ height: "100%" }}
      header={
        <Button
          size="small"
          sx={{ mt: 1 }}
          variant="contained"
          onClick={() => setLogData([])}
        >
          {t("Clear")}
        </Button>
      }
    >
      <Paper sx={{ boxShadow: 2, height: "100%" }}>
        <Virtuoso
          initialTopMostItemIndex={999}
          data={logData}
          itemContent={(index, item) => <LogItem value={item} />}
          followOutput={"smooth"}
        />
      </Paper>
    </BasePage>
  );
};

export default LogPage;
