import { useMemo } from "react";

import { useAppData } from "@/providers/app-data-context";

const PRIMARY_KEYWORDS_LOWER = ["auto", "select", "proxy", "节点选择", "自动选择"];

// 定义代理组类型
interface ProxyGroup {
  name: string;
  now: string;
}

// 获取当前代理节点信息的自定义Hook
export const useCurrentProxy = () => {
  // 从AppDataProvider获取数据
  const { proxies, clashConfig, refreshProxy } = useAppData();

  // 获取当前模式
  const currentMode = clashConfig?.mode?.toLowerCase() || "rule";

  // 获取当前代理节点信息
  const currentProxyInfo = useMemo(() => {
    if (!proxies) return { currentProxy: null, primaryGroupName: null };

    const { global, groups, records } = proxies;

    // 默认信息
    let primaryGroupName = "GLOBAL";
    let currentName = global?.now;

    // 在规则模式下，寻找主要代理组（通常是第一个或者名字包含特定关键词的组）
    if (currentMode === "rule" && groups.length > 0) {
      // 查找主要的代理组（优先级：包含关键词 > 第一个非GLOBAL组）
      let primaryGroup: ProxyGroup | undefined;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i] as ProxyGroup;
        const nameLower = group.name.toLowerCase();
        for (let k = 0; k < PRIMARY_KEYWORDS_LOWER.length; k++) {
          if (nameLower.includes(PRIMARY_KEYWORDS_LOWER[k])) {
            primaryGroup = group;
            break;
          }
        }
        if (primaryGroup) break;
      }
      if (!primaryGroup) {
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i] as ProxyGroup;
          if (g.name !== "GLOBAL") {
            primaryGroup = g;
            break;
          }
        }
      }

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
