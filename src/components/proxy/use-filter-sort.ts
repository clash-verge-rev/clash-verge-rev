import { useEffect, useMemo, useReducer, useRef } from "react";

import { useVerge } from "@/hooks/use-verge";
import delayManager from "@/services/delay";
import { compileStringMatcher } from "@/utils/search-matcher";

// default | delay | alphabet
export type ProxySortType = 0 | 1 | 2;

export type ProxySearchState = {
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegularExpression?: boolean;
};

export default function useFilterSort(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType,
  searchState?: ProxySearchState,
) {
  const { verge } = useVerge();
  const [_, bumpRefresh] = useReducer((count: number) => count + 1, 0);
  const lastInputRef = useRef<{ text: string; sort: ProxySortType } | null>(
    null,
  );
  const debounceTimerRef = useRef<number | null>(null);

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

  const compute = useMemo(() => {
    const fp = filterProxies(proxies, groupName, filterText, searchState);
    const sp = sortProxies(
      fp,
      groupName,
      sortType,
      verge?.default_latency_timeout,
    );
    return sp;
  }, [
    proxies,
    groupName,
    filterText,
    sortType,
    searchState,
    verge?.default_latency_timeout,
  ]);

  const [result, setResult] = useReducer(
    (_prev: IProxyItem[], next: IProxyItem[]) => next,
    compute,
  );

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const prev = lastInputRef.current;
    const stableInputs =
      prev && prev.text === filterText && prev.sort === sortType;

    lastInputRef.current = { text: filterText, sort: sortType };

    const delay = stableInputs ? 0 : 150;
    debounceTimerRef.current = window.setTimeout(() => {
      setResult(compute);
      debounceTimerRef.current = null;
    }, delay);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [compute, filterText, sortType]);

  return result;
}

export function filterSort(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType,
  latencyTimeout?: number,
  searchState?: ProxySearchState,
) {
  const fp = filterProxies(proxies, groupName, filterText, searchState);
  const sp = sortProxies(fp, groupName, sortType, latencyTimeout);
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
  searchState?: ProxySearchState,
) {
  const query = filterText.trim();
  if (!query) return proxies;

  const res1 = regex1.exec(query);
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

  const res2 = regex2.exec(query);
  if (res2) {
    const type = res2[1].toLowerCase();
    return proxies.filter((p) => p.type.toLowerCase().includes(type));
  }

  const {
    matchCase = false,
    matchWholeWord = false,
    useRegularExpression = false,
  } = searchState ?? {};
  const compiled = compileStringMatcher(query, {
    matchCase,
    matchWholeWord,
    useRegularExpression,
  });

  if (!compiled.isValid) return [];
  return proxies.filter((p) => compiled.matcher(p.name));
}

/**
 * sort the proxy
 */
function sortProxies(
  proxies: IProxyItem[],
  groupName: string,
  sortType: ProxySortType,
  latencyTimeout?: number,
) {
  if (!proxies) return [];
  if (sortType === 0) return proxies;

  const list = proxies.slice();
  const effectiveTimeout =
    typeof latencyTimeout === "number" && latencyTimeout > 0
      ? latencyTimeout
      : 10000;

  if (sortType === 1) {
    const categorizeDelay = (delay: number): [number, number] => {
      if (!Number.isFinite(delay)) return [3, Number.MAX_SAFE_INTEGER];
      if (delay > 1e5) return [4, delay];
      if (delay === 0 || (delay >= effectiveTimeout && delay <= 1e5)) {
        return [3, delay || effectiveTimeout];
      }
      if (delay < 0) {
        // sentinel delays (-1, -2, etc.) should always sort after real measurements
        return [5, Number.MAX_SAFE_INTEGER];
      }
      return [0, delay];
    };

    list.sort((a, b) => {
      const ad = delayManager.getDelayFix(a, groupName);
      const bd = delayManager.getDelayFix(b, groupName);
      const [ar, av] = categorizeDelay(ad);
      const [br, bv] = categorizeDelay(bd);

      if (ar !== br) return ar - br;
      return av - bv;
    });
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return list;
}
