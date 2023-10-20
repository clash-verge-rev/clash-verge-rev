import { Grid, IconButton, Paper } from "@mui/material";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { BasePage, Notice } from "@/components/base";
import { GitHub } from "@mui/icons-material";
import { openWebUrl } from "@/services/cmds";
import SettingVerge from "@/components/setting/setting-verge";
import SettingClash from "@/components/setting/setting-clash";
import SettingSystem from "@/components/setting/setting-system";

const SettingPage = () => {
  const { t } = useTranslation();

  const onError = (err: any) => {
    Notice.error(err?.message || err.toString());
  };

  const toGithubRepo = useLockFn(() => {
    return openWebUrl("https://github.com/zzzgydi/clash-verge");
  });

  return (
    <BasePage
      title={t("Settings")}
      header={
        <IconButton
          size="small"
          color="inherit"
          title="@zzzgydi/clash-verge"
          onClick={toGithubRepo}
        >
          <GitHub fontSize="inherit" />
        </IconButton>
      }
    >
      <Grid container spacing={{ xs: 2, lg: 3 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ borderRadius: 1, boxShadow: 2 }}>
            <SettingClash onError={onError} />
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ borderRadius: 1, boxShadow: 2 }}>
            <SettingSystem onError={onError} />
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ borderRadius: 1, boxShadow: 2 }}>
            <SettingVerge onError={onError} />
          </Paper>
        </Grid>
      </Grid>
    </BasePage>
  );
};

export default SettingPage;
