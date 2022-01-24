import useSWR, { useSWRConfig } from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Button, ButtonGroup, List, Paper } from "@mui/material";
import { getClashConfig, updateConfigs, updateProxy } from "../services/api";
import { patchClashConfig } from "../services/cmds";
import { getProxies } from "../services/api";
import BasePage from "../components/base-page";
import ProxyItem from "../components/proxy-item";
import ProxyGroup from "../components/proxy-group";

const ProxyPage = () => {
  const { mutate } = useSWRConfig();
  const { data: proxiesData } = useSWR("getProxies", getProxies);
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);
  const [curProxy, setCurProxy] = useState<string>("DIRECT");
  const curMode = clashConfig?.mode.toLowerCase();

  // proxy groups
  const { groups = [] } = proxiesData ?? {};
  // proxies and sorted
  const filterProxies = useMemo(() => {
    if (!proxiesData?.proxies) return [];

    const list = Object.values(proxiesData.proxies);
    const retList = list.filter(
      (p) => !p.all?.length && p.name !== "DIRECT" && p.name !== "REJECT"
    );
    const direct = list.filter((p) => p.name === "DIRECT");
    const reject = list.filter((p) => p.name === "REJECT");

    return direct.concat(retList).concat(reject);
  }, [proxiesData]);

  const modeList = ["rule", "global", "direct"];
  const asGroup = curMode === "rule" || !groups.length;

  // make sure that fetch the proxies successfully
  useEffect(() => {
    if (
      (curMode === "rule" && !groups.length) ||
      (curMode === "global" && filterProxies.length < 4)
    ) {
      setTimeout(() => mutate("getProxies"), 500);
    }
  }, [groups, filterProxies, curMode]);

  // update the current proxy
  useEffect(() => {
    if (curMode === "direct") setCurProxy("DIRECT");
    if (curMode === "global") {
      const globalNow = proxiesData?.proxies?.GLOBAL?.now;
      setCurProxy(globalNow || "DIRECT");
    }
  }, [curMode, proxiesData]);

  const changeLockRef = useRef(false);
  const onChangeMode = async (mode: string) => {
    if (changeLockRef.current) return;
    changeLockRef.current = true;

    try {
      // switch rapidly
      await updateConfigs({ mode });
      await patchClashConfig({ mode });
      mutate("getClashConfig");
    } finally {
      changeLockRef.current = false;
    }
  };

  const onChangeProxy = async (name: string) => {
    if (curMode !== "global") return;
    await updateProxy("GLOBAL", name);
    setCurProxy(name);
  };

  // difference style
  const pageStyle = asGroup ? {} : { height: "100%" };
  const paperStyle: any = asGroup
    ? { mb: 0.5 }
    : { py: 1, height: "100%", boxSizing: "border-box" };

  return (
    <BasePage
      contentStyle={pageStyle}
      title={asGroup ? "Proxy Groups" : "Proxies"}
      header={
        <ButtonGroup size="small">
          {modeList.map((mode) => (
            <Button
              key={mode}
              variant={mode === curMode ? "contained" : "outlined"}
              onClick={() => onChangeMode(mode)}
              sx={{ textTransform: "capitalize" }}
            >
              {mode}
            </Button>
          ))}
        </ButtonGroup>
      }
    >
      <Paper sx={{ borderRadius: 1, boxShadow: 2, ...paperStyle }}>
        {asGroup ? (
          <List>
            {groups.map((group) => (
              <ProxyGroup key={group.name} group={group} />
            ))}
          </List>
        ) : (
          // virtual list
          <Virtuoso
            style={{ height: "100%" }}
            totalCount={filterProxies.length}
            itemContent={(index) => (
              <ProxyItem
                proxy={filterProxies[index]}
                selected={filterProxies[index].name === curProxy}
                onClick={onChangeProxy}
                sx={{ py: 0, px: 2 }}
              />
            )}
          />
        )}
      </Paper>
    </BasePage>
  );
};

export default ProxyPage;
