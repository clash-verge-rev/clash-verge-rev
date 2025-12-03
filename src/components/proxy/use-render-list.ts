import { useEffect, useMemo } from "react";
import useSWR from "swr";

import { useProxiesData } from "@/hooks/use-clash-data";
import { useVerge } from "@/hooks/use-verge";
import { getRuntimeConfig } from "@/services/cmds";
import delayManager from "@/services/delay";
import { debugLog } from "@/utils/debug";

import { filterSort } from "./use-filter-sort";
import {
  DEFAULT_STATE,
  useHeadStateNew,
  type HeadState,
} from "./use-head-state";
import { useWindowWidth } from "./use-window-width";

// 定义代理项接口
interface IProxyItem {
  name: string;
  type: string;
  udp: boolean;
  xudp: boolean;
  tfo: boolean;
  mptcp: boolean;
  smux: boolean;
  history: {
    time: string;
    delay: number;
  }[];
  provider?: string;
  testUrl?: string;
  [key: string]: any; // 添加索引签名以适应其他可能的属性
}

// 代理组类型
type ProxyGroup = IProxyGroupItem & {
  now?: string;
};

export interface IRenderItem {
  // 组 | head | item | empty | item col
  type: 0 | 1 | 2 | 3 | 4;
  key: string;
  group: ProxyGroup;
  proxy?: IProxyItem;
  col?: number;
  proxyCol?: IProxyItem[];
  headState?: HeadState;
  // 新增支持图标和其他元数据
  icon?: string;
  provider?: string;
  testUrl?: string;
}

// 优化列布局计算
const calculateColumns = (width: number, configCol: number): number => {
  if (configCol > 0 && configCol < 6) return configCol;

  if (width > 1920) return 5;
  if (width > 1450) return 4;
  if (width > 1024) return 3;
  if (width > 900) return 2;
  if (width >= 600) return 2;
  return 1;
};

// 优化分组逻辑
const groupProxies = <T = any>(list: T[], size: number): T[][] => {
  return list.reduce((acc, item) => {
    const lastGroup = acc[acc.length - 1];
    if (!lastGroup || lastGroup.length >= size) {
      acc.push([item]);
    } else {
      lastGroup.push(item);
    }
    return acc;
  }, [] as T[][]);
};

export const useRenderList = (
  mode: string,
  isChainMode?: boolean,
  selectedGroup?: string | null,
) => {
  // 使用全局数据提供者
  const { proxies: proxiesData, refreshProxy } = useProxiesData();
  const { verge } = useVerge();
  const { width } = useWindowWidth();
  const [headStates, setHeadState] = useHeadStateNew();
  const latencyTimeout = verge?.default_latency_timeout;

  // 获取运行时配置用于链式代理模式
  const { data: runtimeConfig } = useSWR(
    isChainMode ? "getRuntimeConfig" : null,
    getRuntimeConfig,
    {
      revalidateOnFocus: false,
      revalidateIfStale: true,
    },
  );

  // 计算列数
  const col = useMemo(
    () => calculateColumns(width, verge?.proxy_layout_column || 6),
    [width, verge?.proxy_layout_column],
  );

  // 确保代理数据加载
  useEffect(() => {
    if (!proxiesData) return;
    const { groups, proxies } = proxiesData;

    if (
      (mode === "rule" && !groups.length) ||
      (mode === "global" && proxies.length < 2)
    ) {
      const handle = setTimeout(() => refreshProxy(), 500);
      return () => clearTimeout(handle);
    }
  }, [proxiesData, mode, refreshProxy]);

  // 链式代理模式节点自动计算延迟
  useEffect(() => {
    if (!isChainMode || !runtimeConfig) return;

    const allProxies: IProxyItem[] = Object.values(
      (runtimeConfig as any).proxies || {},
    );
    if (allProxies.length === 0) return;

    // 设置组监听器，当有延迟更新时自动刷新
    const groupListener = () => {
      debugLog("[ChainMode] 延迟更新，刷新UI");
      refreshProxy();
    };

    delayManager.setGroupListener("chain-mode", groupListener);

    const calculateDelays = async () => {
      try {
        const timeout = verge?.default_latency_timeout || 10000;
        const proxyNames = allProxies.map((proxy) => proxy.name);

        debugLog(`[ChainMode] 开始计算 ${proxyNames.length} 个节点的延迟`);

        // 使用 delayManager 计算延迟，每个节点计算完成后会自动触发监听器刷新界面
        delayManager.checkListDelay(proxyNames, "chain-mode", timeout);
      } catch (error) {
        console.error("Failed to calculate delays for chain mode:", error);
      }
    };

    // 延迟执行避免阻塞
    const handle = setTimeout(calculateDelays, 100);

    return () => {
      clearTimeout(handle);
      // 清理组监听器
      delayManager.removeGroupListener("chain-mode");
    };
  }, [
    isChainMode,
    runtimeConfig,
    verge?.default_latency_timeout,
    refreshProxy,
  ]);

  // 处理渲染列表
  const renderList: IRenderItem[] = useMemo(() => {
    if (!proxiesData) return [];

    // 链式代理模式下，显示代理组和其节点
    if (isChainMode && runtimeConfig && mode === "rule") {
      // 使用正常的规则模式代理组
      const allGroups = proxiesData.groups.length
        ? proxiesData.groups
        : [proxiesData.global!];

      // 如果选择了特定代理组，只显示该组的节点
      if (selectedGroup) {
        const targetGroup = allGroups.find(
          (g: any) => g.name === selectedGroup,
        );
        if (targetGroup) {
          const proxies = filterSort(
            targetGroup.all,
            targetGroup.name,
            "",
            0,
            latencyTimeout,
          );

          if (col > 1) {
            return groupProxies(proxies, col).map((proxyCol, colIndex) => ({
              type: 4,
              key: `chain-col-${selectedGroup}-${colIndex}`,
              group: targetGroup,
              headState: DEFAULT_STATE,
              col,
              proxyCol,
              provider: proxyCol[0]?.provider,
            }));
          } else {
            return proxies.map((proxy) => ({
              type: 2,
              key: `chain-${selectedGroup}-${proxy!.name}`,
              group: targetGroup,
              proxy,
              headState: DEFAULT_STATE,
              provider: proxy.provider,
            }));
          }
        }
        return [];
      }

      // 如果没有选择特定组，显示第一个组的节点（如果有组的话）
      if (allGroups.length > 0) {
        const firstGroup = allGroups[0];
        const proxies = filterSort(
          firstGroup.all,
          firstGroup.name,
          "",
          0,
          latencyTimeout,
        );

        if (col > 1) {
          return groupProxies(proxies, col).map((proxyCol, colIndex) => ({
            type: 4,
            key: `chain-col-first-${colIndex}`,
            group: firstGroup,
            headState: DEFAULT_STATE,
            col,
            proxyCol,
            provider: proxyCol[0]?.provider,
          }));
        } else {
          return proxies.map((proxy) => ({
            type: 2,
            key: `chain-first-${proxy!.name}`,
            group: firstGroup,
            proxy,
            headState: DEFAULT_STATE,
            provider: proxy.provider,
          }));
        }
      }

      // 如果没有组，显示所有节点
      const allProxies: IProxyItem[] = allGroups.flatMap(
        (group: any) => group.all,
      );

      // 为每个节点获取延迟信息
      const proxiesWithDelay = allProxies.map((proxy) => {
        const delay = delayManager.getDelay(proxy.name, "chain-mode");
        return {
          ...proxy,
          // 如果delayManager有延迟数据，更新history
          history:
            delay >= 0
              ? [{ time: new Date().toISOString(), delay }]
              : proxy.history || [],
        };
      });

      // 创建一个虚拟的组来容纳所有节点
      const virtualGroup: ProxyGroup = {
        name: "All Proxies",
        type: "Selector",
        udp: false,
        xudp: false,
        tfo: false,
        mptcp: false,
        smux: false,
        history: [],
        now: "",
        all: proxiesWithDelay,
      };

      if (col > 1) {
        return groupProxies(proxiesWithDelay, col).map(
          (proxyCol, colIndex) => ({
            type: 4,
            key: `chain-col-all-${colIndex}`,
            group: virtualGroup,
            headState: DEFAULT_STATE,
            col,
            proxyCol,
            provider: proxyCol[0]?.provider,
          }),
        );
      } else {
        return proxiesWithDelay.map((proxy) => ({
          type: 2,
          key: `chain-all-${proxy.name}`,
          group: virtualGroup,
          proxy,
          headState: DEFAULT_STATE,
          provider: proxy.provider,
        }));
      }
    }

    // 链式代理模式下的其他模式（如global）仍显示所有节点
    if (isChainMode && runtimeConfig) {
      // 从运行时配置直接获取 proxies 列表 (需要类型断言)
      const allProxies: IProxyItem[] = Object.values(
        (runtimeConfig as any).proxies || {},
      );

      // 为每个节点获取延迟信息
      const proxiesWithDelay = allProxies.map((proxy) => {
        const delay = delayManager.getDelay(proxy.name, "chain-mode");
        return {
          ...proxy,
          // 如果delayManager有延迟数据，更新history
          history:
            delay >= 0
              ? [{ time: new Date().toISOString(), delay }]
              : proxy.history || [],
        };
      });

      // 创建一个虚拟的组来容纳所有节点
      const virtualGroup: ProxyGroup = {
        name: "All Proxies",
        type: "Selector",
        udp: false,
        xudp: false,
        tfo: false,
        mptcp: false,
        smux: false,
        history: [],
        now: "",
        all: proxiesWithDelay,
      };

      // 返回节点列表（不显示组头）
      if (col > 1) {
        return groupProxies(proxiesWithDelay, col).map(
          (proxyCol, colIndex) => ({
            type: 4,
            key: `chain-col-${colIndex}`,
            group: virtualGroup,
            headState: DEFAULT_STATE,
            col,
            proxyCol,
            provider: proxyCol[0]?.provider,
          }),
        );
      } else {
        return proxiesWithDelay.map((proxy) => ({
          type: 2,
          key: `chain-${proxy.name}`,
          group: virtualGroup,
          proxy,
          headState: DEFAULT_STATE,
          provider: proxy.provider,
        }));
      }
    }

    // 正常模式的渲染逻辑
    const useRule = mode === "rule" || mode === "script";
    const renderGroups =
      useRule && proxiesData.groups.length
        ? proxiesData.groups
        : [proxiesData.global!];

    const retList = renderGroups.flatMap((group: ProxyGroup) => {
      const headState = headStates[group.name] || DEFAULT_STATE;
      const ret: IRenderItem[] = [
        {
          type: 0,
          key: group.name,
          group,
          headState,
          icon: group.icon,
          testUrl: group.testUrl,
        },
      ];

      if (headState?.open || !useRule) {
        const proxies = filterSort(
          group.all,
          group.name,
          headState.filterText,
          headState.sortType,
          latencyTimeout,
        );

        ret.push({
          type: 1,
          key: `head-${group.name}`,
          group,
          headState,
        });

        if (!proxies.length) {
          ret.push({
            type: 3,
            key: `empty-${group.name}`,
            group,
            headState,
          });
        } else if (col > 1) {
          return ret.concat(
            groupProxies(proxies, col).map((proxyCol, colIndex) => ({
              type: 4,
              key: `col-${group.name}-${proxyCol[0].name}-${colIndex}`,
              group,
              headState,
              col,
              proxyCol,
              provider: proxyCol[0].provider,
            })),
          );
        } else {
          return ret.concat(
            proxies.map((proxy) => ({
              type: 2,
              key: `${group.name}-${proxy!.name}`,
              group,
              proxy,
              headState,
              provider: proxy.provider,
            })),
          );
        }
      }
      return ret;
    });

    if (!useRule) return retList.slice(1);
    return retList.filter((item: IRenderItem) => !item.group.hidden);
  }, [
    headStates,
    proxiesData,
    mode,
    col,
    isChainMode,
    runtimeConfig,
    selectedGroup,
    latencyTimeout,
  ]);

  return {
    renderList,
    onProxies: refreshProxy,
    onHeadState: setHeadState,
    currentColumns: col,
  };
};

// 优化建议：如有大数据量，建议用虚拟滚动（已在 ProxyGroups 组件中实现），此处无需额外处理。
