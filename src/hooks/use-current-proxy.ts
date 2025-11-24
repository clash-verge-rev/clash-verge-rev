import { useMemo } from "react";

import { useClashConfig, useProxiesData } from "@/hooks/app-data";

// 获取当前代理节点信息的自定义Hook
export const useCurrentProxy = () => {
  const { proxies, refreshProxy } = useProxiesData();
  const { clashConfig } = useClashConfig();

  // 获取当前模式
  const currentMode = clashConfig?.mode?.toLowerCase() || "rule";

  // 获取当前代理节点信息
  const currentProxyInfo = useMemo(() => {
    if (!proxies) return { currentProxy: null, primaryGroupName: null };

    const globalGroup = proxies.global as IProxyGroupItem | undefined;
    const groups: IProxyGroupItem[] = Array.isArray(proxies.groups)
      ? (proxies.groups as IProxyGroupItem[])
      : [];
    const records = (proxies.records || {}) as Record<string, IProxyItem>;

    // 默认信息
    let primaryGroupName = "GLOBAL";
    let currentName = globalGroup?.now;

    // 在规则模式下，寻找主要代理组（通常是第一个或者名字包含特定关键词的组）
    if (currentMode === "rule" && groups.length > 0) {
      // 查找主要的代理组（优先级：包含关键词 > 第一个非GLOBAL组）
      const primaryKeywords = [
        "auto",
        "select",
        "proxy",
        "节点选择",
        "自动选择",
      ];
      const primaryGroup =
        groups.find((group) =>
          primaryKeywords.some((keyword) =>
            group.name.toLowerCase().includes(keyword.toLowerCase()),
          ),
        ) || groups.filter((g) => g.name !== "GLOBAL")[0];

      if (primaryGroup) {
        primaryGroupName = primaryGroup.name;
        currentName = primaryGroup.now;
      }
    }

    // 如果找不到当前节点，返回null
    if (!currentName) return { currentProxy: null, primaryGroupName };

    // 获取完整的节点信息
    const currentProxy = records[currentName] || {
      name: currentName,
      type: "Unknown",
      udp: false,
      xudp: false,
      tfo: false,
      mptcp: false,
      smux: false,
      history: [],
    };

    return { currentProxy, primaryGroupName };
  }, [proxies, currentMode]);

  return {
    currentProxy: currentProxyInfo.currentProxy,
    primaryGroupName: currentProxyInfo.primaryGroupName,
    mode: currentMode,
    refreshProxy,
  };
};
