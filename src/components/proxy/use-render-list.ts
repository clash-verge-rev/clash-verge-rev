import useSWR from "swr";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { getProxies } from "@/services/api";
import { useVerge } from "@/hooks/use-verge";
import { filterSort } from "./use-filter-sort";
import { useWindowWidth } from "./use-window-width";
import {
  useHeadStateNew,
  DEFAULT_STATE,
  type HeadState,
} from "./use-head-state";

export interface IRenderItem {
  // 组 ｜ head ｜ item ｜ empty | item col
  type: 0 | 1 | 2 | 3 | 4;
  key: string;
  group: IProxyGroupItem;
  proxy?: IProxyItem;
  col?: number;
  proxyCol?: IProxyItem[];
  headState?: HeadState;
}

interface ProxiesData {
  groups: IProxyGroupItem[];
  global?: IProxyGroupItem;
  proxies: any[];
}

// 缓存计算结果
const groupCache = new WeakMap<ProxiesData, Map<string, IProxyGroupItem>>();
// 用于追踪缓存的key
const cacheKeys = new Set<ProxiesData>();

export const useRenderList = (mode: string) => {
  // 添加用户交互标记
  const isUserInteracting = useRef(false);
  const interactionTimer = useRef<number | null>(null);
  // 添加上一次有效的数据缓存
  const [lastValidData, setLastValidData] = useState<ProxiesData | null>(null);
  // 添加刷新锁
  const refreshLock = useRef(false);
  const lastRenderList = useRef<IRenderItem[]>([]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (interactionTimer.current) {
        clearTimeout(interactionTimer.current);
      }
      refreshLock.current = false;
      isUserInteracting.current = false;
      // 清理 WeakMap 缓存
      cacheKeys.forEach((key) => {
        groupCache.delete(key);
      });
      cacheKeys.clear();
    };
  }, []);

  // 优化数据获取函数
  const fetchProxies = useCallback(async () => {
    try {
      if (isUserInteracting.current || refreshLock.current) {
        return lastValidData;
      }
      const data = await getProxies();

      // 预处理和缓存组数据
      if (data && !groupCache.has(data)) {
        const groupMap = new Map();
        data.groups.forEach((group) => {
          groupMap.set(group.name, group);
        });
        groupCache.set(data, groupMap);
        cacheKeys.add(data);
      }

      setLastValidData(data);
      return data;
    } catch (error) {
      if (lastValidData) return lastValidData;
      throw error;
    }
  }, [lastValidData]);

  const { data: proxiesData, mutate: mutateProxies } = useSWR(
    "getProxies",
    fetchProxies,
    {
      refreshInterval: 2000,
      dedupingInterval: 1000,
      revalidateOnFocus: false,
      keepPreviousData: true,
      onSuccess: (data) => {
        if (!data || isUserInteracting.current) return;

        if (proxiesData) {
          try {
            const groupMap = groupCache.get(proxiesData);
            if (!groupMap) return;

            const needUpdate = data.groups.some((group: IProxyGroupItem) => {
              const oldGroup = groupMap.get(group.name);
              if (!oldGroup) return true;

              return (
                oldGroup.now !== group.now ||
                oldGroup.type !== group.type ||
                JSON.stringify(oldGroup.all) !== JSON.stringify(group.all)
              );
            });

            if (!needUpdate) {
              return;
            }
          } catch (e) {
            console.error("Data comparison error:", e);
            return;
          }
        }
      },
    },
  );

  // 优化mutateProxies包装函数
  const wrappedMutateProxies = useCallback(async () => {
    if (interactionTimer.current) {
      clearTimeout(interactionTimer.current);
    }

    try {
      // 立即更新本地状态以响应UI
      if (proxiesData) {
        const currentGroup = proxiesData.groups.find(
          (g) => g.now !== undefined,
        );
        if (currentGroup) {
          const optimisticData = { ...proxiesData };
          setLastValidData(optimisticData);
        }
      }

      // 执行实际的更新并等待结果
      const result = await mutateProxies();

      // 更新最新数据
      if (result) {
        setLastValidData(result);
      }

      return result;
    } catch (error) {
      console.error("Failed to update proxies:", error);
      // 发生错误时恢复到之前的状态
      if (proxiesData) {
        setLastValidData(proxiesData);
      }
      throw error;
    } finally {
      // 重置状态
      isUserInteracting.current = false;
      refreshLock.current = false;
      if (interactionTimer.current) {
        clearTimeout(interactionTimer.current);
        interactionTimer.current = null;
      }
    }
  }, [proxiesData, mutateProxies]);

  // 确保初始数据加载后更新lastValidData
  useEffect(() => {
    if (proxiesData && !lastValidData) {
      setLastValidData(proxiesData);
    }
  }, [proxiesData]);

  const { verge } = useVerge();
  const { width } = useWindowWidth();

  const col = useMemo(() => {
    const baseCol = Math.floor(verge?.proxy_layout_column || 6);
    if (baseCol >= 6 || baseCol <= 0) {
      if (width > 1450) return 4;
      if (width > 1024) return 3;
      if (width > 900) return 2;
      if (width >= 600) return 2;
      return 1;
    }
    return baseCol;
  }, [verge?.proxy_layout_column, width]);

  const [headStates, setHeadState] = useHeadStateNew();

  // 优化初始数据加载
  useEffect(() => {
    if (!proxiesData) return;
    const { groups, proxies } = proxiesData;

    if (
      (mode === "rule" && !groups.length) ||
      (mode === "global" && proxies.length < 2)
    ) {
      const timer = setTimeout(() => mutateProxies(), 500);
      return () => clearTimeout(timer);
    }
  }, [proxiesData, mode, mutateProxies]);

  // 优化渲染列表计算
  const renderList = useMemo(() => {
    const currentData = proxiesData || lastValidData;
    if (!currentData) return lastRenderList.current;

    const useRule = mode === "rule" || mode === "script";
    const renderGroups =
      (useRule && currentData.groups.length
        ? currentData.groups
        : [currentData.global!]) || [];

    const newList = renderGroups.flatMap((group: IProxyGroupItem) => {
      const headState = headStates[group.name] || DEFAULT_STATE;
      const ret: IRenderItem[] = [
        { type: 0, key: group.name, group, headState },
      ];

      if (headState?.open || !useRule) {
        const proxies = filterSort(
          group.all,
          group.name,
          headState.filterText,
          headState.sortType,
        );

        ret.push({ type: 1, key: `head-${group.name}`, group, headState });

        if (!proxies.length) {
          ret.push({ type: 3, key: `empty-${group.name}`, group, headState });
          return ret;
        }

        if (col > 1) {
          return ret.concat(
            groupList(proxies, col).map((proxyCol) => ({
              type: 4,
              key: `col-${group.name}-${proxyCol[0].name}`,
              group,
              headState,
              col,
              proxyCol,
            })),
          );
        }

        return ret.concat(
          proxies.map((proxy) => ({
            type: 2,
            key: `${group.name}-${proxy!.name}`,
            group,
            proxy,
            headState,
          })),
        );
      }
      return ret;
    });

    const filteredList = !useRule
      ? newList.slice(1)
      : newList.filter((item) => !item.group.hidden);

    lastRenderList.current = filteredList;
    return filteredList;
  }, [headStates, proxiesData, lastValidData, mode, col]);

  // 添加滚动处理
  useEffect(() => {
    const handleScroll = () => {
      if (!isUserInteracting.current) {
        isUserInteracting.current = true;

        // 清除之前的定时器
        if (interactionTimer.current) {
          clearTimeout(interactionTimer.current);
        }

        // 设置新的定时器，在滚动停止后恢复刷新
        interactionTimer.current = window.setTimeout(() => {
          isUserInteracting.current = false;
          // 手动触发一次更新
          wrappedMutateProxies();
        }, 1000) as unknown as number;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (interactionTimer.current) {
        clearTimeout(interactionTimer.current);
      }
    };
  }, [wrappedMutateProxies]);

  return {
    renderList,
    onProxies: wrappedMutateProxies,
    onHeadState: setHeadState,
  };
};

function groupList<T = any>(list: T[], size: number): T[][] {
  return list.reduce((p, n) => {
    if (!p.length) return [[n]];

    const i = p.length - 1;
    if (p[i].length < size) {
      p[i].push(n);
      return p;
    }

    p.push([n]);
    return p;
  }, [] as T[][]);
}
