import axiosIns from "./base";

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

export type ProxyGroupItem = Omit<ProxyItem, "all" | "now"> & {
  all?: ProxyItem[];
  now?: string;
};

/// Get the Proxy infomation
export async function getProxyInfo() {
  const response = (await axiosIns.get("/proxies")) as any;
  const results = (response?.proxies ?? {}) as Record<string, ProxyItem>;

  const global = results["GLOBAL"] || results["global"];
  const proxies = Object.values(results).filter((each) => each.all == null);

  const groups = Object.values(results).filter(
    (each) => each.name.toLocaleUpperCase() !== "GLOBAL" && each.all != null
  ) as ProxyGroupItem[];

  groups.forEach((each) => {
    // @ts-ignore
    each.all = each.all?.map((item) => results[item]).filter((e) => e);
  });

  return {
    global,
    groups,
    proxies,
  };
}

/// Update the Proxy Choose
export async function updateProxy(group: string, proxy: string) {
  return axiosIns.put(`/proxies/${group}`, { name: proxy });
}
