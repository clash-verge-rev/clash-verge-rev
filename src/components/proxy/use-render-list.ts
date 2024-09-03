import { useEffect, useMemo, useCallback } from "react";
import { useVerge } from "@/hooks/use-verge";
import { filterSort } from "./use-filter-sort";
import { useWindowWidth } from "./use-window-width";
import {
  useHeadStateNew,
  DEFAULT_STATE,
  type HeadState,
} from "./use-head-state";
<<<<<<< HEAD
import { useAppData } from "@/providers/app-data-provider";

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
type ProxyGroup = {
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
  now: string;
  all: IProxyItem[];
  hidden?: boolean;
  icon?: string;
  testUrl?: string;
  provider?: string;
};
import { truncate } from "lodash-es";

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

export const useRenderList = (mode: string) => {
  // 使用全局数据提供者
  const { proxies: proxiesData, refreshProxy } = useAppData();
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
      setTimeout(() => refreshProxy(), 500);
    }
  }, [proxiesData, mode, refreshProxy]);

  // 处理渲染列表
  const renderList: IRenderItem[] = useMemo(() => {
    if (!proxiesData) return [];

    const useRule = mode === "rule" || mode === "script";
    const renderGroups =
      useRule && proxiesData.groups.length
        ? proxiesData.groups
        : [proxiesData.global!];

    const retList = renderGroups.flatMap((group: ProxyGroup) => {
      const headState = headStates[group.name] || DEFAULT_STATE;
      const hiddenInvalidNetwork = headState.hiddenInvalidNetwork;
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

      // Invalid filter network
      if (hiddenInvalidNetwork) {
        let proxys = group.all.filter((item) => {
          if (item.all) {
            return false;
          }

          if (item.history) {
            const history = item.history;
            let min = Math.min(3, history.length);
            let recentHistory = history.slice(0, min);
            let hasInvalidNetwork =
              recentHistory.filter((item) => item.delay == 0).length > 0;
            if (hasInvalidNetwork) {
              return false;
            }
          }

          return true;
        });
        group.all = proxys;
      }

      // Invalid filter network
      if (hiddenInvalidNetwork) {
        let proxys = group.all.filter((item) => {
          if (item.all) {
            return true;
          }

          if (item.history) {
            const history = item.history;
            let min = Math.min(3, history.length);
            let recentHistory = history.slice(
              history.length - min,
              history.length,
            );
            let hasInvalidNetwork =
              recentHistory.filter((item) => item.delay == 0).length > 0;
            if (hasInvalidNetwork) {
              return false;
            }
          }

          return true;
        });
        group.all = proxys;
      }

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
  }, [headStates, proxiesData, mode, col]);

  return {
    renderList,
    onProxies: refreshProxy,
    onHeadState: setHeadState,
    currentColumns: col,
  };
};
