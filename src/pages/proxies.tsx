import useSWR from "swr";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Button, ButtonGroup, Paper } from "@mui/material";
import { getClashConfig, updateConfigs } from "@/services/api";
import { patchClashConfig } from "@/services/cmds";
import { ProxyGroups } from "@/components/proxy/proxy-groups";
import { BasePage } from "@/components/base";

const ProxyPage = () => {
  const { t } = useTranslation();

  const { data: clashConfig, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig
  );

  const modeList = ["rule", "global", "direct", "script"];
  const curMode = clashConfig?.mode.toLowerCase();

  const onChangeMode = useLockFn(async (mode: string) => {
    await updateConfigs({ mode });
    await patchClashConfig({ mode });
    mutateClash();
  });

  return (
    <BasePage
      contentStyle={{ height: "100%" }}
      title={t("Proxy Groups")}
      header={
        <ButtonGroup size="small">
          {modeList.map((mode) => (
            <Button
              key={mode}
              variant={mode === curMode ? "contained" : "outlined"}
              onClick={() => onChangeMode(mode)}
              sx={{ textTransform: "capitalize" }}
            >
              {t(mode)}
            </Button>
          ))}
        </ButtonGroup>
      }
    >
      <Paper
        sx={{
          borderRadius: 1,
          boxShadow: 2,
          height: "100%",
          boxSizing: "border-box",
          py: 1,
        }}
      >
        <ProxyGroups mode={curMode!} />
      </Paper>
    </BasePage>
  );
};

export default ProxyPage;
