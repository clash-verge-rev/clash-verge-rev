import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  getBaseConfig,
  getRuleProviders,
  getRules,
} from "tauri-plugin-mihomo-api";

import {
  calcuProxies,
  calcuProxyProviders,
  getAppUptime,
  getSystemProxy,
} from "@/services/cmds";
import { SWR_DEFAULTS, SWR_REALTIME, SWR_SLOW_POLL } from "@/services/config";

import { useSharedSWRPoller } from "./use-shared-swr-poller";
import { useVerge } from "./use-verge";

export const useProxiesData = () => {
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR("getProxies", calcuProxies, {
    ...SWR_REALTIME,
    refreshInterval: 0,
    onError: (err) => console.warn("[AppData] Proxy fetch failed:", err),
  });

  const refreshProxy = useCallback(
    () => globalMutate("getProxies"),
    [globalMutate],
  );
  const pollerRefresh = useCallback(() => {
    void globalMutate("getProxies");
  }, [globalMutate]);

  useSharedSWRPoller("getProxies", SWR_REALTIME.refreshInterval, pollerRefresh);

  return {
    proxies: data,
    refreshProxy,
    isLoading,
    error,
  };
};

export const useClashConfig = () => {
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR("getClashConfig", getBaseConfig, {
    ...SWR_SLOW_POLL,
    refreshInterval: 0,
  });

  const refreshClashConfig = useCallback(
    () => globalMutate("getClashConfig"),
    [globalMutate],
  );
  const pollerRefresh = useCallback(() => {
    void globalMutate("getClashConfig");
  }, [globalMutate]);

  useSharedSWRPoller(
    "getClashConfig",
    SWR_SLOW_POLL.refreshInterval,
    pollerRefresh,
  );

  return {
    clashConfig: data,
    refreshClashConfig,
    isLoading,
    error,
  };
};

export const useProxyProvidersData = () => {
  const { data, error, isLoading, mutate } = useSWR(
    "getProxyProviders",
    calcuProxyProviders,
    SWR_DEFAULTS,
  );

  const refreshProxyProviders = useCallback(() => mutate(), [mutate]);

  return {
    proxyProviders: data || {},
    refreshProxyProviders,
    isLoading,
    error,
  };
};

export const useRuleProvidersData = () => {
  const { data, error, isLoading, mutate } = useSWR(
    "getRuleProviders",
    getRuleProviders,
    SWR_DEFAULTS,
  );

  const refreshRuleProviders = useCallback(() => mutate(), [mutate]);

  return {
    ruleProviders: data?.providers || {},
    refreshRuleProviders,
    isLoading,
    error,
  };
};

export const useRulesData = () => {
  const { data, error, isLoading, mutate } = useSWR(
    "getRules",
    getRules,
    SWR_DEFAULTS,
  );

  const refreshRules = useCallback(() => mutate(), [mutate]);

  return {
    rules: data?.rules || [],
    refreshRules,
    isLoading,
    error,
  };
};

export const useSystemProxyData = () => {
  const { data, error, isLoading, mutate } = useSWR(
    "getSystemProxy",
    getSystemProxy,
    SWR_DEFAULTS,
  );

  const refreshSysproxy = useCallback(() => mutate(), [mutate]);

  return {
    sysproxy: data,
    refreshSysproxy,
    isLoading,
    error,
  };
};

type ClashConfig = Awaited<ReturnType<typeof getBaseConfig>>;
type SystemProxy = Awaited<ReturnType<typeof getSystemProxy>>;

interface SystemProxyAddressParams {
  clashConfig?: ClashConfig | null;
  sysproxy?: SystemProxy | null;
}

export const useSystemProxyAddress = ({
  clashConfig,
  sysproxy,
}: SystemProxyAddressParams) => {
  const { verge } = useVerge();

  return useMemo(() => {
    if (!verge || !clashConfig) return "-";

    const isPacMode = verge.proxy_auto_config ?? false;

    if (isPacMode) {
      const proxyHost = verge.proxy_host || "127.0.0.1";
      const proxyPort = verge.verge_mixed_port || clashConfig.mixedPort || 7897;
      return [proxyHost, proxyPort].join(":");
    }

    const systemServer = sysproxy?.server;
    if (systemServer && systemServer !== "-" && !systemServer.startsWith(":")) {
      return systemServer;
    }

    const proxyHost = verge.proxy_host || "127.0.0.1";
    const proxyPort = verge.verge_mixed_port || clashConfig.mixedPort || 7897;
    return [proxyHost, proxyPort].join(":");
  }, [clashConfig, sysproxy, verge]);
};

export const useAppUptime = () => {
  const { data, error, isLoading } = useSWR("appUptime", getAppUptime, {
    ...SWR_DEFAULTS,
    refreshInterval: 3000,
    errorRetryCount: 1,
  });

  return {
    uptime: data || 0,
    error,
    isLoading,
  };
};

export const useRefreshAll = () => {
  const { mutate } = useSWRConfig();

  return useCallback(async () => {
    await Promise.all([
      mutate("getProxies"),
      mutate("getClashConfig"),
      mutate("getRules"),
      mutate("getSystemProxy"),
      mutate("getProxyProviders"),
      mutate("getRuleProviders"),
    ]);
  }, [mutate]);
};
