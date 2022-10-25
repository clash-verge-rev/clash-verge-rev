import useSWR, { useSWRConfig } from "swr";
import { useEffect, useMemo } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Button, ButtonGroup, List, Paper } from "@mui/material";
import { getClashConfig, updateConfigs } from "@/services/api";
import { patchClashConfig } from "@/services/cmds";
import { getProxies } from "@/services/api";
import BasePage from "@/components/base/base-page";
import BaseEmpty from "@/components/base/base-empty";
import ProxyGroup from "@/components/proxy/proxy-group";

const ProxyPage = () => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: proxiesData } = useSWR("getProxies", getProxies, {
    refreshInterval: 45000, // 45s
  });
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);

  const modeList = ["rule", "global", "direct", "script"];
  const curMode = clashConfig?.mode.toLowerCase();
  const { global, groups = [], proxies = [] } = proxiesData ?? {};

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

  // 仅mode为全局和直连的时候展示global分组
  const displayGroups = useMemo(() => {
    if (!global) return groups;
    if (curMode === "global" || curMode === "direct")
      return [global, ...groups];
    return groups;
  }, [global, groups, curMode]);

  // difference style
  const showGroup = displayGroups.length > 0;
  const pageStyle = showGroup ? {} : { height: "100%" };
  const paperStyle: any = showGroup
    ? { mb: 0.5 }
    : { py: 1, height: "100%", boxSizing: "border-box" };

  return (
    <BasePage
      contentStyle={pageStyle}
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
      <Paper sx={{ borderRadius: 1, boxShadow: 2, ...paperStyle }}>
        {displayGroups.length > 0 ? (
          <List>
            {displayGroups.map((group) => (
              <ProxyGroup key={group.name} group={group} />
            ))}
          </List>
        ) : (
          <BaseEmpty />
        )}
      </Paper>
    </BasePage>
  );
};

export default ProxyPage;
