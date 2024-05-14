import { Box, ButtonGroup, Grid, IconButton } from "@mui/material";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { BasePage, Notice } from "@/components/base";
import { GitHub, HelpOutlineSharp } from "@mui/icons-material";
import { openWebUrl } from "@/services/cmds";
import SettingVerge from "@/components/setting/setting-verge";
import SettingClash from "@/components/setting/setting-clash";
import SettingSystem from "@/components/setting/setting-system";
import { atomThemeMode } from "@/services/states";
import { useRecoilState } from "recoil";

const SettingPage = () => {
  const { t } = useTranslation();

  const onError = (err: any) => {
    Notice.error(err?.message || err.toString());
  };

  const toGithubRepo = useLockFn(() => {
    return openWebUrl("https://github.com/clash-verge-rev/clash-verge-rev");
  });

  const toGithubDoc = useLockFn(() => {
    return openWebUrl("https://clash-verge-rev.github.io/guide/log.html");
  });

  const [mode] = useRecoilState(atomThemeMode);
  const isDark = mode === "light" ? false : true;

  return (
    <BasePage
      title={t("Settings")}
      header={
        <ButtonGroup variant="contained" aria-label="Basic button group">
          <IconButton
            size="medium"
            color="inherit"
            title="@clash-verge-rev/clash-verge-rev.github.io"
            onClick={toGithubDoc}
          >
            <HelpOutlineSharp fontSize="inherit" />
          </IconButton>
          <IconButton
            size="medium"
            color="inherit"
            title="@clash-verge-rev/clash-verge-rev"
            onClick={toGithubRepo}
          >
            <GitHub fontSize="inherit" />
          </IconButton>
        </ButtonGroup>
      }
    >
      <Grid container spacing={{ xs: 1.5, lg: 1.5 }}>
        <Grid item xs={12} md={6}>
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
        <Grid item xs={12} md={6}>
          <Box
            sx={{
              borderRadius: 2,
              backgroundColor: isDark ? "#282a36" : "#ffffff",
            }}
          >
            <SettingVerge onError={onError} />
          </Box>
        </Grid>
      </Grid>
    </BasePage>
  );
};

export default SettingPage;
