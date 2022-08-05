import useSWR, { useSWRConfig } from "swr";
import { useEffect } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Button, ButtonGroup, List, Paper } from "@mui/material";
import { getClashConfig, updateConfigs } from "@/services/api";
import { patchClashConfig } from "@/services/cmds";
import { getProxies } from "@/services/api";
import BasePage from "@/components/base/base-page";
import ProxyGroup from "@/components/proxy/proxy-group";
import ProxyGlobal from "@/components/proxy/proxy-global";

const ProxyPage = () => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: proxiesData } = useSWR("getProxies", getProxies);
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);

  const modeList = ["rule", "global", "direct", "script"];
  const curMode = clashConfig?.mode.toLowerCase();
  const { groups = [], proxies = [] } = proxiesData ?? {};

  // make sure that fetch the proxies successfully
  useEffect(() => {
    if (
      (curMode === "rule" && !groups.length) ||
      (curMode === "global" && proxies.length < 2)
    ) {
      setTimeout(() => mutate("getProxies"), 500);
    }
  }, [groups, proxies, curMode]);

  const onChangeMode = useLockFn(async (mode: string) => {
    // switch rapidly
    await updateConfigs({ mode });
    await patchClashConfig({ mode });
    mutate("getClashConfig");
  });

  // difference style
  const showGroup =
    (curMode === "rule" || curMode === "script") && !!groups.length;
  const pageStyle = showGroup ? {} : { height: "100%" };
  const paperStyle: any = showGroup
    ? { mb: 0.5 }
    : { py: 1, height: "100%", boxSizing: "border-box" };

  return (
    <BasePage
      contentStyle={pageStyle}
      title={showGroup ? t("Proxy Groups") : t("Proxies")}
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
      <Paper sx={{ borderRadius: 1, boxShadow: 2, ...paperStyle }}>
        {(curMode === "rule" || curMode === "script") && !!groups.length && (
          <List>
            {groups.map((group) => (
              <ProxyGroup key={group.name} group={group} />
            ))}
          </List>
        )}
        {((curMode === "rule" && !groups.length) || curMode === "global") && (
          <ProxyGlobal
            groupName="GLOBAL"
            curProxy={proxiesData?.global?.now}
            proxies={proxies}
          />
        )}
        {curMode === "direct" && (
          <ProxyGlobal
            groupName="DIRECT"
            curProxy="DIRECT"
            proxies={[proxiesData?.direct!].filter(Boolean)}
          />
        )}
      </Paper>
    </BasePage>
  );
};

export default ProxyPage;
