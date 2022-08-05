import { useMemo } from "react";
import delayManager from "@/services/delay";

// default | delay | alpha
export type ProxySortType = 0 | 1 | 2;

/**
 * sort the proxy
 */
export default function useSortProxy(
  proxies: ApiType.ProxyItem[],
  groupName: string,
  sortType: ProxySortType
) {
  return useMemo(() => {
    if (!proxies) return [];
    if (sortType === 0) return proxies;

    const list = proxies.slice();

    if (sortType === 1) {
      list.sort((a, b) => {
        const ad = delayManager.getDelay(a.name, groupName);
        const bd = delayManager.getDelay(b.name, groupName);

        if (ad === -1) return 1;
        if (bd === -1) return -1;

        return ad - bd;
      });
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [proxies, groupName, sortType]);
}
