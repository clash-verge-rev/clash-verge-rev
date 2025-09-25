import useSWR, { mutate } from "swr";

import { useVerge } from "@/hooks/use-verge";
import { useAppData } from "@/providers/app-data-provider";
import { getAutotemProxy } from "@/services/cmds";
import { closeAllConnections } from "@/services/cmds";

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

    // 用户配置状态应该与系统实际状态一致
    // 如果用户启用了系统代理，检查实际的系统状态
    if (userEnabled) {
      if (proxy_auto_config) {
        return autoproxy?.enable ?? false;
      } else {
        return sysproxy?.enable ?? false;
      }
    }

    // 用户没有启用时，返回 false
    return false;
  };

  const getSystemProxyIndicator = () => {
    if (proxy_auto_config) {
      return autoproxy?.enable ?? false;
    } else {
      return sysproxy?.enable ?? false;
    }
  };

  const updateProxyStatus = async () => {
    // 减少延迟，并发更新缓存
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 并发清除缓存，获取最新status
    await Promise.all([
      mutate("getSystemProxy", undefined, { revalidate: true }),
      mutate("getAutotemProxy", undefined, { revalidate: true }),
    ]);

    // 减少等待时间
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  const toggleSystemProxy = async (enabled: boolean) => {
    // 先更新UI状态
    mutateVerge({ ...verge, enable_system_proxy: enabled }, false);

    try {
      if (!enabled && verge?.auto_close_connection) {
        await closeAllConnections();
      }

      // 等待配置更新完成
      await patchVerge({ enable_system_proxy: enabled });

      // 减少延迟，快速更新代理状态
      await new Promise((resolve) => setTimeout(resolve, 150));
      await updateProxyStatus();
    } catch (error) {
      console.warn("[useSystemProxyState] toggleSystemProxy failed:", error);
      // 发生错误时恢复之前的状态
      mutateVerge({ ...verge, enable_system_proxy: !enabled }, false);
      throw error;
    }
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
