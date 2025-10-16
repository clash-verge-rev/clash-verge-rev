import { useEffect, useMemo, useReducer } from "react";

import delayManager from "@/services/delay";

// default | delay | alphabet
export type ProxySortType = 0 | 1 | 2;

export default function useFilterSort(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType,
) {
  const [_, bumpRefresh] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    let last = 0;

    delayManager.setGroupListener(groupName, () => {
      // 简单节流
      const now = Date.now();
      if (now - last > 666) {
        last = now;
        bumpRefresh();
      }
    });

    return () => {
      delayManager.removeGroupListener(groupName);
    };
  }, [groupName]);

  return useMemo(() => {
    const fp = filterProxies(proxies, groupName, filterText);
    const sp = sortProxies(fp, groupName, sortType);
    return sp;
  }, [proxies, groupName, filterText, sortType]);
}

export function filterSort(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType,
) {
  const fp = filterProxies(proxies, groupName, filterText);
  const sp = sortProxies(fp, groupName, sortType);
  return sp;
}

/**
 * 可以通过延迟数/节点类型 过滤
 */
const regex1 = /delay([=<>])(\d+|timeout|error)/i;
const regex2 = /type=(.*)/i;

/**
 * filter the proxy
 * according to the regular conditions
 */
function filterProxies(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
) {
  if (!filterText) return proxies;

  const res1 = regex1.exec(filterText);
  if (res1) {
    const symbol = res1[1];
    const symbol2 = res1[2].toLowerCase();
    const value =
      symbol2 === "error" ? 1e5 : symbol2 === "timeout" ? 3000 : +symbol2;

    return proxies.filter((p) => {
      const delay = delayManager.getDelayFix(p, groupName);

      if (delay < 0) return false;
      if (symbol === "=" && symbol2 === "error") return delay >= 1e5;
      if (symbol === "=" && symbol2 === "timeout")
        return delay < 1e5 && delay >= 3000;
      if (symbol === "=") return delay == value;
      if (symbol === "<") return delay <= value;
      if (symbol === ">") return delay >= value;
      return false;
    });
  }

  const res2 = regex2.exec(filterText);
  if (res2) {
    const type = res2[1].toLowerCase();
    return proxies.filter((p) => p.type.toLowerCase().includes(type));
  }

  return proxies.filter((p) => p.name.includes(filterText.trim()));
}

/**
 * sort the proxy
 */
function sortProxies(
  proxies: IProxyItem[],
  groupName: string,
  sortType: ProxySortType,
) {
  if (!proxies) return [];
  if (sortType === 0) return proxies;

  const list = proxies.slice();

  if (sortType === 1) {
    const toSortableValue = (delay: number) => {
      if (!Number.isFinite(delay) || delay <= 0) return Number.MAX_SAFE_INTEGER;
      return delay;
    };

    list.sort((a, b) => {
      const ad = toSortableValue(delayManager.getDelayFix(a, groupName));
      const bd = toSortableValue(delayManager.getDelayFix(b, groupName));

      return ad - bd;
    });
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return list;
}
