import { useMemo } from "react";
import delayManager from "@/services/delay";

const regex1 = /delay([=<>])(\d+|timeout|error)/i;
const regex2 = /type=(.*)/i;

/**
 * filter the proxy
 * according to the regular conditions
 */
export default function useFilterProxy(
  proxies: ApiType.ProxyItem[],
  groupName: string,
  filterText: string
) {
  return useMemo(() => {
    if (!proxies) return [];
    if (!filterText) return proxies;

    const res1 = regex1.exec(filterText);
    if (res1) {
      const symbol = res1[1];
      const symbol2 = res1[2].toLowerCase();
      const value =
        symbol2 === "error" ? 1e5 : symbol2 === "timeout" ? 3000 : +symbol2;

      return proxies.filter((p) => {
        const delay = delayManager.getDelay(p.name, groupName);

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
  }, [proxies, groupName, filterText]);
}
