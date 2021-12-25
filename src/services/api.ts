import axios, { AxiosInstance } from "axios";
import { getClashInfo } from "./cmds";
import { ApiType } from "./types";

let axiosIns: AxiosInstance = null!;
let server = "";
let secret = "";

/// initialize some infomation
export async function getAxios() {
  if (axiosIns) return axiosIns;

  try {
    const info = await getClashInfo();

    if (info?.controller?.server) server = info?.controller?.server;
    if (info?.controller?.secret) secret = info?.controller?.secret;
  } catch {}

  axiosIns = axios.create({
    baseURL: `http://${server}`,
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  axiosIns.interceptors.response.use((r) => r.data);
  return axiosIns;
}

/// get infomation
export async function getInfomation() {
  if (server) return { server, secret };
  const info = await getClashInfo();
  return info?.controller!;
}

/// Get Version
export async function getVersion() {
  const instance = await getAxios();
  return instance.get("/version") as Promise<{
    premium: boolean;
    version: string;
  }>;
}

/// Get current base configs
export async function getClashConfig() {
  const instance = await getAxios();
  return instance.get("/configs") as Promise<ApiType.ConfigData>;
}

/// Update current configs
export async function updateConfigs(config: Partial<ApiType.ConfigData>) {
  const instance = await getAxios();
  return instance.patch("/configs", config);
}

/// Get current rules
export async function getRules() {
  const instance = await getAxios();
  return instance.get("/rules") as Promise<ApiType.RuleItem[]>;
}

/// Update the Proxy Choose
export async function updateProxy(group: string, proxy: string) {
  const instance = await getAxios();
  return instance.put(`/proxies/${group}`, { name: proxy });
}

/// Get the Proxy infomation
export async function getProxies() {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/proxies");
  const proxies = (response?.proxies ?? {}) as Record<
    string,
    ApiType.ProxyItem
  >;

  const global = proxies["GLOBAL"];
  const order = global?.all;

  let groups: ApiType.ProxyGroupItem[] = [];

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
