import useSWR from "swr";
import { getProxies } from "@/services/api";
import { useEffect, useMemo } from "react";
import { filterSort } from "./use-filter-sort";
import {
  useHeadStateNew,
  DEFAULT_STATE,
  type HeadState,
} from "./use-head-state";

export interface IRenderItem {
  type: 0 | 1 | 2 | 3; // 组 ｜ head ｜ item ｜ empty
  key: string;
  group: IProxyGroupItem;
  proxy?: IProxyItem;
  headState?: HeadState;
}

export const useRenderList = (mode: string) => {
  const { data: proxiesData, mutate: mutateProxies } = useSWR(
    "getProxies",
    getProxies,
    { refreshInterval: 45000 }
  );

  const [headStates, setHeadState] = useHeadStateNew();

  // make sure that fetch the proxies successfully
  useEffect(() => {
    if (!proxiesData) return;
    const { groups, proxies } = proxiesData;

    if (
      (mode === "rule" && !groups.length) ||
      (mode === "global" && proxies.length < 2)
    ) {
      setTimeout(() => mutateProxies(), 500);
    }
  }, [proxiesData, mode]);

  const renderList: IRenderItem[] = useMemo(() => {
    if (!proxiesData) return [];

    // global 和 direct 使用展开的样式
    const useRule = mode === "rule" || mode === "script";
    const renderGroups =
      (useRule ? proxiesData?.groups : [proxiesData?.global!]) || [];

    const retList = renderGroups.flatMap((group) => {
      const headState = headStates[group.name] || DEFAULT_STATE;
      const ret: IRenderItem[] = [
        { type: 0, key: group.name, group, headState },
      ];

      if (headState?.open || !useRule) {
        const proxies = filterSort(
          group.all,
          group.name,
          headState.filterText,
          headState.sortType
        );

        ret.push({ type: 1, key: `head${group.name}`, group, headState });

        if (!proxies.length) {
          ret.push({ type: 3, key: `empty${group.name}`, group, headState });
        }

        return ret.concat(
          proxies.map((proxy) => ({
            type: 2,
            key: `${group.name}-${proxy!.name}`,
            group,
            proxy,
            headState,
          }))
        );
      }
      return ret;
    });

    if (!useRule) return retList.slice(1);
    return retList;
  }, [headStates, proxiesData, mode]);

  return {
    renderList,
    onProxies: mutateProxies,
    onHeadState: setHeadState,
  };
};
