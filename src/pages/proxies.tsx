import useSWR from "swr";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Box, Button, ButtonGroup } from "@mui/material";
import {
  closeAllConnections,
  getClashConfig,
  getRuntimeProxyChainConfig,
  updateProxyChainConfigInRuntime,
} from "@/services/cmds";
import { patchClashMode } from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import { BasePage } from "@/components/base";
import { ProxyGroups } from "@/components/proxy/proxy-groups";
import { ProviderButton } from "@/components/proxy/provider-button";

const ProxyPage = () => {
  const { t } = useTranslation();

  // 从 localStorage 恢复链式代理按钮状态
  const [isChainMode, setIsChainMode] = useState(() => {
    try {
      const saved = localStorage.getItem("proxy-chain-mode-enabled");
      return saved === "true";
    } catch {
      return false;
    }
  });

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
    const newChainMode = !isChainMode;

    if (!newChainMode) {
      // 退出链式代理模式时，清除链式代理配置
      try {
        console.log("Exiting chain mode, clearing chain configuration");
        await updateProxyChainConfigInRuntime(null);
        console.log("Chain configuration cleared successfully");
      } catch (error) {
        console.error("Failed to clear chain configuration:", error);
      }
    }

    setIsChainMode(newChainMode);

    // 保存链式代理按钮状态到 localStorage
    localStorage.setItem("proxy-chain-mode-enabled", newChainMode.toString());
  });

  // 当开启链式代理模式时，获取配置数据
  useEffect(() => {
    if (isChainMode) {
      const fetchChainConfig = async () => {
        try {
          const configData = await getRuntimeProxyChainConfig();
          setChainConfigData(configData || "");
        } catch (error) {
          console.error("Failed to get runtime proxy chain config:", error);
          setChainConfigData("");
        }
      };

      fetchChainConfig();
    } else {
      setChainConfigData(null);
    }
  }, [isChainMode]);

  useEffect(() => {
    if (curMode && !modeList.includes(curMode)) {
      onChangeMode("rule");
    }
  }, [curMode]);

  return (
    <BasePage
      full
      contentStyle={{ height: "101.5%" }}
      title={isChainMode ? t("Node Pool") : t("Proxy Groups")}
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
