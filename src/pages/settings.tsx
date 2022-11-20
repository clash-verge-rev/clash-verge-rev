import { Paper } from "@mui/material";
import { useTranslation } from "react-i18next";
import { BasePage, Notice } from "@/components/base";
import SettingVerge from "@/components/setting/setting-verge";
import SettingClash from "@/components/setting/setting-clash";
import SettingSystem from "@/components/setting/setting-system";

const SettingPage = () => {
  const { t } = useTranslation();

  const onError = (err: any) => {
    Notice.error(err?.message || err.toString());
  };

  return (
    <BasePage title={t("Settings")}>
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
