import { getAxios } from "./base";

export interface ProxyItem {
  name: string;
  type: string;
  udp: boolean;
  history: {
    time: string;
    delay: number;
  }[];
  all?: string[];
  now?: string;
}

export type ProxyGroupItem = Omit<ProxyItem, "all"> & {
  all: ProxyItem[];
};

/// Get the Proxy infomation
export async function getProxies() {
  const axiosIns = await getAxios();
  const response = await axiosIns.get<any, any>("/proxies");
  const proxies = (response?.proxies ?? {}) as Record<string, ProxyItem>;

  const global = proxies["GLOBAL"];
  const order = global?.all;

  let groups: ProxyGroupItem[] = [];

  if (order) {
    groups = order
      .filter((name) => proxies[name]?.all)
      .map((name) => proxies[name])
      .map((each) => ({
        ...each,
        all: each.all!.map((item) => proxies[item]),
      }));
  } else {
    groups = Object.values(proxies)
      .filter((each) => each.name !== "GLOBAL" && each.all)
      .map((each) => ({
        ...each,
        all: each.all!.map((item) => proxies[item]),
      }));
    groups.sort((a, b) => b.name.localeCompare(a.name));
  }

  return { global, groups, proxies };
}

/// Update the Proxy Choose
export async function updateProxy(group: string, proxy: string) {
  return (await getAxios()).put(`/proxies/${group}`, { name: proxy });
}
