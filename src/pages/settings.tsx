import { Box, ButtonGroup, IconButton, Select, MenuItem } from "@mui/material";
import Grid from "@mui/material/Grid2";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { BasePage, Notice } from "@/components/base";
import { GitHub, HelpOutlineRounded, Telegram } from "@mui/icons-material";
import { openWebUrl } from "@/services/cmds";
import SettingVergeBasic from "@/components/setting/setting-verge-basic";
import SettingVergeAdvanced from "@/components/setting/setting-verge-advanced";
import SettingClash from "@/components/setting/setting-clash";
import SettingSystem from "@/components/setting/setting-system";
import { useThemeMode } from "@/services/states";

const SettingPage = () => {
  const { t } = useTranslation();

  const onError = (err: any) => {
    Notice.error(err?.message || err.toString());
  };

  const mode = useThemeMode();
  const isDark = mode === "light" ? false : true;

  return (
    <BasePage
      title={t("Settings")}
    >
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        <Grid size={6}>
          <Box
            sx={{
              borderRadius: 2,
              marginBottom: 1.5,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <SettingSystem onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <SettingClash onError={onError} />
          </Box>
        </Grid>
        <Grid size={6}>
          <Box
            sx={{
              borderRadius: 2,
              marginBottom: 1.5,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <SettingVergeBasic onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <SettingVergeAdvanced onError={onError} />
          </Box>
        </Grid>
      </Grid>
    </BasePage>
  );
};

export default SettingPage;
