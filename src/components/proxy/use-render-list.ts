import useSWR from "swr";
import { useEffect, useMemo, useCallback } from "react";
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
  // 组 | head | item | empty | item col
  type: 0 | 1 | 2 | 3 | 4;
  key: string;
  group: IProxyGroupItem;
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

export const useRenderList = (mode: string) => {
  const { data: proxiesData, mutate: mutateProxies } = useSWR(
    "getProxies",
    getProxies,
    {
      refreshInterval: 2000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    },
  );

  const { verge } = useVerge();
  const { width } = useWindowWidth();
  const [headStates, setHeadState] = useHeadStateNew();

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
      setTimeout(() => mutateProxies(), 500);
    }
  }, [proxiesData, mode, mutateProxies]);

  // 处理渲染列表
  const renderList: IRenderItem[] = useMemo(() => {
    if (!proxiesData) return [];

    const useRule = mode === "rule" || mode === "script";
    const renderGroups =
      useRule && proxiesData.groups.length
        ? proxiesData.groups
        : [proxiesData.global!];

    const retList = renderGroups.flatMap((group) => {
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
            groupProxies(proxies, col).map((proxyCol) => ({
              type: 4,
              key: `col-${group.name}-${proxyCol[0].name}`,
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
    return retList.filter((item) => !item.group.hidden);
  }, [headStates, proxiesData, mode, col]);

  return {
    renderList,
    onProxies: mutateProxies,
    onHeadState: setHeadState,
    currentColumns: col,
  };
};
