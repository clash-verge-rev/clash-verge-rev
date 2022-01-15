import { Paper } from "@mui/material";
import BasePage from "../components/base-page";
import SettingVerge from "../components/setting-verge";
import SettingClash from "../components/setting-clash";

const SettingPage = () => {
  return (
    <BasePage title="Settings">
      <Paper sx={{ borderRadius: 1, boxShadow: 2 }}>
        <SettingVerge />
      </Paper>

      <Paper sx={{ borderRadius: 1, boxShadow: 2, mt: 3 }}>
        <SettingClash />
      </Paper>
    </BasePage>
  );
};

export default SettingPage;
