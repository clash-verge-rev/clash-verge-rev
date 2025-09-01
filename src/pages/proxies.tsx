import useSWR from "swr";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Box, Button, ButtonGroup } from "@mui/material";
import {
  closeAllConnections,
  getClashConfig,
  getRuntimeProxyChainConfig,
} from "@/services/cmds";
import { patchClashMode } from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import { BasePage } from "@/components/base";
import { ProxyGroups } from "@/components/proxy/proxy-groups";
import { ProviderButton } from "@/components/proxy/provider-button";

const ProxyPage = () => {
  const { t } = useTranslation();
  const [isChainMode, setIsChainMode] = useState(false);
  const [chainConfigData, setChainConfigData] = useState<string | null>(null);

  const { data: clashConfig, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig,
    {
      revalidateOnFocus: false,
      revalidateIfStale: true,
      dedupingInterval: 1000,
      errorRetryInterval: 5000,
    },
  );

  const { verge } = useVerge();

  const modeList = ["rule", "global", "direct"];

  const curMode = clashConfig?.mode?.toLowerCase();

  const onChangeMode = useLockFn(async (mode: string) => {
    // 断开连接
    if (mode !== curMode && verge?.auto_close_connection) {
      closeAllConnections();
    }
    await patchClashMode(mode);
    mutateClash();
  });

  const onToggleChainMode = useLockFn(async () => {
    if (!isChainMode) {
      // When entering chain mode, fetch the chain config data
      try {
        const configData = await getRuntimeProxyChainConfig();
        setChainConfigData(configData);
        setIsChainMode(true);
      } catch (error) {
        console.error("Failed to get runtime proxy chain config:", error);
        // Set empty config data if failed
        setChainConfigData("");
        setIsChainMode(true);
      }
    } else {
      // When exiting chain mode
      setIsChainMode(false);
      setChainConfigData(null);
    }
  });

  useEffect(() => {
    if (curMode && !modeList.includes(curMode)) {
      onChangeMode("rule");
    }
  }, [curMode]);

  return (
    <BasePage
      full
      contentStyle={{ height: "101.5%" }}
      title={t("Proxy Groups")}
      header={
        <Box display="flex" alignItems="center" gap={1}>
          <ProviderButton />

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

          <Button
            size="small"
            variant={isChainMode ? "contained" : "outlined"}
            onClick={onToggleChainMode}
            sx={{ ml: 1 }}
          >
            {t("Chain Proxy")}
          </Button>
        </Box>
      }
    >
      <ProxyGroups
        mode={curMode!}
        isChainMode={isChainMode}
        chainConfigData={chainConfigData}
      />
    </BasePage>
  );
};

export default ProxyPage;
