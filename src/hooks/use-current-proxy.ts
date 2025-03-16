import useSWR from "swr";
import { useMemo } from "react";
import { getProxies } from "@/services/api";
import { getClashConfig } from "@/services/api";

// 获取当前代理节点信息的自定义Hook
export const useCurrentProxy = () => {
  // 获取代理信息
  const { data: proxiesData, mutate: mutateProxies } = useSWR(
    "getProxies",
    getProxies,
    {
      refreshInterval: 2000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    },
  );

  // 获取当前Clash配置（包含模式信息）
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);

  // 获取当前模式
  const currentMode = clashConfig?.mode?.toLowerCase() || "rule";

  // 获取当前代理节点信息
  const currentProxyInfo = useMemo(() => {
    if (!proxiesData) return { currentProxy: null, primaryGroupName: null };

    const { global, groups, records } = proxiesData;

    // 默认信息
    let primaryGroupName = "GLOBAL";
    let currentName = global?.now;

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
  }, [proxiesData, currentMode]);

  return {
    currentProxy: currentProxyInfo.currentProxy,
    primaryGroupName: currentProxyInfo.primaryGroupName,
    mode: currentMode,
    refreshProxy: mutateProxies,
  };
};
