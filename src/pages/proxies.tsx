import { LanOutlined, LanRounded } from "@mui/icons-material";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useLockFn } from "ahooks";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { closeAllConnections, getBaseConfig } from "tauri-plugin-mihomo-api";

import { BasePage } from "@/components/base";
import { ProviderButton } from "@/components/proxy/provider-button";
import { ProxyGroups } from "@/components/proxy/proxy-groups";
import { useVerge } from "@/hooks/use-verge";
import {
  getRuntimeProxyChainConfig,
  patchClashMode,
  updateProxyChainConfigInRuntime,
} from "@/services/cmds";
import { debugLog } from "@/utils/debug";

const MODES = ["rule", "global", "direct"] as const;
type Mode = (typeof MODES)[number];
const MODE_SET = new Set<string>(MODES);
const isMode = (value: unknown): value is Mode =>
  typeof value === "string" && MODE_SET.has(value);

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

  const [chainConfigData, dispatchChainConfigData] = useReducer(
    (_: string | null, action: string | null) => action,
    null as string | null,
  );

  const updateChainConfigData = useCallback((value: string | null) => {
    dispatchChainConfigData(value);
  }, []);

  const { data: clashConfig, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getBaseConfig,
    {
      revalidateOnFocus: false,
      revalidateIfStale: true,
      dedupingInterval: 1000,
      errorRetryInterval: 5000,
    },
  );

  const { verge } = useVerge();

  const modeList = useMemo(() => MODES, []);

  const normalizedMode = clashConfig?.mode?.toLowerCase();
  const curMode = isMode(normalizedMode) ? normalizedMode : undefined;

  const onChangeMode = useLockFn(async (mode: Mode) => {
    // 断开连接
    if (mode !== curMode && verge?.auto_close_connection) {
      closeAllConnections();
    }
    await patchClashMode(mode);
    mutateClash();
  });

  const onToggleChainMode = useLockFn(async () => {
    const newChainMode = !isChainMode;

    setIsChainMode(newChainMode);
    // 保存链式代理按钮状态到 localStorage
    localStorage.setItem("proxy-chain-mode-enabled", newChainMode.toString());

    if (!newChainMode) {
      // 退出链式代理模式时，清除链式代理配置
      try {
        debugLog("Exiting chain mode, clearing chain configuration");
        await updateProxyChainConfigInRuntime(null);
        debugLog("Chain configuration cleared successfully");
      } catch (error) {
        console.error("Failed to clear chain configuration:", error);
      }
    }
  });

  // 当开启链式代理模式时，获取配置数据
  useEffect(() => {
    if (!isChainMode) {
      updateChainConfigData(null);
      return;
    }

    let cancelled = false;

    const fetchChainConfig = async () => {
      try {
        const exitNode = localStorage.getItem("proxy-chain-exit-node");

        if (!exitNode) {
          console.error("No proxy chain exit node found in localStorage");
          if (!cancelled) {
            updateChainConfigData("");
          }
          return;
        }

        const configData = await getRuntimeProxyChainConfig(exitNode);
        if (!cancelled) {
          updateChainConfigData(configData || "");
        }
      } catch (error) {
        console.error("Failed to get runtime proxy chain config:", error);
        if (!cancelled) {
          updateChainConfigData("");
        }
      }
    };

    fetchChainConfig();

    return () => {
      cancelled = true;
    };
  }, [isChainMode, updateChainConfigData]);

  useEffect(() => {
    if (normalizedMode && !isMode(normalizedMode)) {
      onChangeMode("rule");
    }
  }, [normalizedMode, onChangeMode]);

  return (
    <BasePage
      full
      contentStyle={{ height: "101.5%" }}
      title={
        isChainMode
          ? t("proxies.page.title.chainMode")
          : t("proxies.page.title.default")
      }
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
                {t(`proxies.page.modes.${mode}`)}
              </Button>
            ))}
          </ButtonGroup>

          <Button
            size="small"
            variant={isChainMode ? "contained" : "outlined"}
            onClick={onToggleChainMode}
            sx={{ ml: 1 }}
            startIcon={
              isChainMode ? (
                <LanRounded fontSize="small" />
              ) : (
                <LanOutlined fontSize="small" />
              )
            }
          >
            {t("proxies.page.actions.toggleChain")}
          </Button>
        </Box>
      }
    >
      <ProxyGroups
        mode={curMode ?? "rule"}
        isChainMode={isChainMode}
        chainConfigData={chainConfigData}
      />
    </BasePage>
  );
};

export default ProxyPage;
