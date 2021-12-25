import axios, { AxiosInstance } from "axios";
import { ApiType } from "./types";

let axiosIns: AxiosInstance = null!;
let server = "127.0.0.1:9090";
let secret = "";

type Callback<T> = (data: T) => void;

/// initialize some infomation
export function initAxios(info: { server?: string; secret?: string }) {
  if (info.server) server = info.server;
  if (info.secret) secret = info.secret;

  axiosIns = axios.create({
    baseURL: `http://${server}`,
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  axiosIns.interceptors.response.use((r) => r.data);
}

/// get infomation
export function getInfomation() {
  return { server, secret };
}

/// Get Version
export async function getVersion() {
  return axiosIns.get("/version") as Promise<{
    premium: boolean;
    version: string;
  }>;
}

/// Get current base configs
export async function getClashConfig() {
  return axiosIns.get("/configs") as Promise<ApiType.ConfigData>;
}

/// Update current configs
export async function updateConfigs(config: Partial<ApiType.ConfigData>) {
  return axiosIns.patch("/configs", config);
}

/// Get current rules
export async function getRules() {
  return axiosIns.get("/rules") as Promise<ApiType.RuleItem[]>;
}

/// Update the Proxy Choose
export async function updateProxy(group: string, proxy: string) {
  return axiosIns.put(`/proxies/${group}`, { name: proxy });
}

/// Get the Proxy infomation
export async function getProxies() {
  const response = await axiosIns.get<any, any>("/proxies");
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
