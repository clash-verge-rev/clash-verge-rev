import useSWR, { mutate } from "swr";
import { useVerge } from "@/hooks/use-verge";
import { getAutotemProxy } from "@/services/cmds";
import { useAppData } from "@/providers/app-data-provider";
import { closeAllConnections } from "@/services/api";

// 系统代理状态检测统一逻辑
export const useSystemProxyState = () => {
  const { verge, mutateVerge, patchVerge } = useVerge();
  const { sysproxy } = useAppData();
  const { data: autoproxy } = useSWR("getAutotemProxy", getAutotemProxy, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const { enable_system_proxy, proxy_auto_config } = verge ?? {};

  const getSystemProxyActualState = () => {
    const userEnabled = enable_system_proxy ?? false;

    if (userEnabled) {
      return true;
    }

    return autoproxy?.enable === false && sysproxy?.enable === false
      ? false
      : userEnabled;
  };

  const getSystemProxyIndicator = () => {
    if (proxy_auto_config) {
      return autoproxy?.enable ?? false;
    } else {
      return sysproxy?.enable ?? false;
    }
  };

  const updateProxyStatus = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await mutate("getSystemProxy");
    await mutate("getAutotemProxy");
  };

  const toggleSystemProxy = (enabled: boolean) => {
    mutateVerge({ ...verge, enable_system_proxy: enabled }, false);

    setTimeout(async () => {
      try {
        if (!enabled && verge?.auto_close_connection) {
          closeAllConnections();
        }
        await patchVerge({ enable_system_proxy: enabled });

        updateProxyStatus();
      } catch (error) {
        mutateVerge({ ...verge, enable_system_proxy: !enabled }, false);
      }
    }, 0);

    return Promise.resolve();
  };

  return {
    actualState: getSystemProxyActualState(),
    indicator: getSystemProxyIndicator(),
    configState: enable_system_proxy ?? false,
    sysproxy,
    autoproxy,
    proxy_auto_config,
    toggleSystemProxy,
  };
};
