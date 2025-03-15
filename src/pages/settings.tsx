import { BasePage, Notice } from "@/components/base";
import SettingClash from "@/components/setting/setting-clash";
import SettingSystem from "@/components/setting/setting-system";
import SettingVerge from "@/components/setting/setting-verge";
import { openWebUrl } from "@/services/cmds";
import { GitHub } from "@mui/icons-material";
import { Box, Grid2 as Grid, IconButton } from "@mui/material";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";

const SettingPage = () => {
  const { t } = useTranslation();

  const onError = (err: any) => {
    Notice.error(err?.message || err.toString());
  };

  const openGithubRepo = useLockFn(() => {
    return openWebUrl("https://github.com/oomeow/clash-verge-self");
  });

  return (
    <BasePage
      title={t("Settings")}
      contentStyle={{ height: "100%" }}
      header={
        <IconButton
          size="medium"
          color="inherit"
          title="@oomeow/clash-verge-self"
          onClick={openGithubRepo}>
          <GitHub fontSize="inherit" />
        </IconButton>
      }>
      <div className="box-border py-2">
        <Grid container spacing={{ xs: 1.5, lg: 1.5 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box
              sx={(theme) => ({
                borderRadius: 2,
                marginBottom: 1.5,
                backgroundColor: "#ffffff",
                ...theme.applyStyles("dark", {
                  backgroundColor: "#282a36",
                }),
              })}>
              <SettingSystem onError={onError} />
            </Box>
            <Box
              sx={(theme) => ({
                borderRadius: 2,
                backgroundColor: "#ffffff",
                ...theme.applyStyles("dark", {
                  backgroundColor: "#282a36",
                }),
              })}>
              <SettingClash onError={onError} />
            </Box>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box
              sx={(theme) => ({
                borderRadius: 2,
                backgroundColor: "#ffffff",
                ...theme.applyStyles("dark", {
                  backgroundColor: "#282a36",
                }),
              })}>
              <SettingVerge onError={onError} />
            </Box>
          </Grid>
        </Grid>
      </div>
    </BasePage>
  );
};

export default SettingPage;
