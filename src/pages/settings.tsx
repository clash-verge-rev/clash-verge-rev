import { Paper } from "@mui/material";
import BasePage from "../components/base-page";
import SettingVerge from "../components/setting/setting-verge";
import SettingClash from "../components/setting/setting-clash";
import SettingSystem from "../components/setting/setting-system";
import Notice from "../components/notice";

const SettingPage = () => {
  const onError = (error: any) => {
    error && Notice.error(error.toString());
  };

  return (
    <BasePage title="Settings">
      <Paper sx={{ borderRadius: 1, boxShadow: 2, mb: 3 }}>
        <SettingClash onError={onError} />
      </Paper>

      <Paper sx={{ borderRadius: 1, boxShadow: 2, mb: 3 }}>
        <SettingSystem onError={onError} />
      </Paper>

      <Paper sx={{ borderRadius: 1, boxShadow: 2 }}>
        <SettingVerge onError={onError} />
      </Paper>
    </BasePage>
  );
};

export default SettingPage;
