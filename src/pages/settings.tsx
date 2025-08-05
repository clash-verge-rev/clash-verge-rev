import { Box, ButtonGroup, IconButton, Grid } from "@mui/material";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { BasePage } from "@/components/base";
import { GitHub, HelpOutlineRounded, Telegram } from "@mui/icons-material";
import { openWebUrl } from "@/services/cmds";
import SettingVergeBasic from "@/components/setting/setting-verge-basic";
import SettingVergeAdvanced from "@/components/setting/setting-verge-advanced";
import SettingClash from "@/components/setting/setting-clash";
import SettingSystem from "@/components/setting/setting-system";
import { CoreHealthStatus } from "@/components/setting/core-health-status";
import { useThemeMode } from "@/services/states";
import { showNotice } from "@/services/noticeService";

const SettingPage = () => {
  const { t } = useTranslation();

  const onError = (err: any) => {
    showNotice("error", err?.message || err.toString());
  };

  const toGithubRepo = useLockFn(() => {
    return openWebUrl("https://github.com/clash-verge-rev/clash-verge-rev");
  });

  const toGithubDoc = useLockFn(() => {
    return openWebUrl("https://clash-verge-rev.github.io/index.html");
  });

  const toTelegramChannel = useLockFn(() => {
    return openWebUrl("https://t.me/clash_verge_re");
  });

  const mode = useThemeMode();
  const isDark = mode === "light" ? false : true;

  return (
    <BasePage
      title={t("Settings")}
      header={
        <ButtonGroup variant="contained" aria-label="Basic button group">
          <IconButton
            size="medium"
            color="inherit"
            title={t("Manual")}
            onClick={toGithubDoc}
          >
            <HelpOutlineRounded fontSize="inherit" />
          </IconButton>
          <IconButton
            size="medium"
            color="inherit"
            title={t("TG Channel")}
            onClick={toTelegramChannel}
          >
            <Telegram fontSize="inherit" />
          </IconButton>

          <IconButton
            size="medium"
            color="inherit"
            title={t("Github Repo")}
            onClick={toGithubRepo}
          >
            <GitHub fontSize="inherit" />
          </IconButton>
        </ButtonGroup>
      }
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
              marginBottom: 1.5,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <SettingClash onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <CoreHealthStatus onError={onError} />
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
