import axios, { AxiosInstance } from "axios";
import { getClashInfo } from "./cmds";

let axiosIns: AxiosInstance = null!;
let server = "";
let secret = "";

/// initialize some infomation
/// enable force update axiosIns
export async function getAxios(force: boolean = false) {
  if (axiosIns && !force) return axiosIns;

  try {
    const info = await getClashInfo();

    if (info?.server) {
      server = info.server;

      // compatible width `external-controller`
      if (server.startsWith(":")) server = `127.0.0.1${server}`;
      else if (/^\d+$/.test(server)) server = `127.0.0.1:${server}`;
    }
    if (info?.secret) secret = info?.secret;
  } catch {}

  axiosIns = axios.create({
    baseURL: `http://${server}`,
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  axiosIns.interceptors.response.use((r) => r.data);
  return axiosIns;
}

/// get information
export async function getInformation() {
  if (server) return { server, secret };
  const info = await getClashInfo();
  return info!;
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

/// Get Proxy delay
export async function getProxyDelay(
  name: string,
  url?: string
): Promise<{ delay: number }> {
  const params = {
    timeout: 3000,
    url: url || "http://www.gstatic.com/generate_204",
  };

  const instance = await getAxios();
  return instance.get(`/proxies/${encodeURIComponent(name)}/delay`, { params });
}

/// Update the Proxy Choose
export async function updateProxy(group: string, proxy: string) {
  const instance = await getAxios();
  return instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy });
}

/// Get the Proxy infomation
export async function getProxies() {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/proxies");
  const records = (response?.proxies ?? {}) as Record<
    string,
    ApiType.ProxyItem
  >;

  const global = records["GLOBAL"];
  const direct = records["DIRECT"];
  const reject = records["REJECT"];
  const order = global?.all;

  let groups: ApiType.ProxyGroupItem[] = [];

  // compatible with proxy-providers
  const generateItem = (name: string) => {
    if (records[name]) return records[name];
    return { name, type: "unknown", udp: false, history: [] };
  };

  if (order) {
    groups = order
      .filter((name) => records[name]?.all)
      .map((name) => records[name])
      .map((each) => ({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      }));
  } else {
    groups = Object.values(records)
      .filter((each) => each.name !== "GLOBAL" && each.all)
      .map((each) => ({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      }));
    groups.sort((a, b) => b.name.localeCompare(a.name));
  }

  const proxies = [direct, reject].concat(
    Object.values(records).filter(
      (p) => !p.all?.length && p.name !== "DIRECT" && p.name !== "REJECT"
    )
  );

  return { global, direct, groups, records, proxies };
}

// todo: get proxy providers
export async function getProviders() {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/providers/proxies");
  return response.providers as any;
}

// todo: proxy providers health check
export async function getProviderHealthCheck(name: string) {
  const instance = await getAxios();
  return instance.get(
    `/providers/proxies/${encodeURIComponent(name)}/healthcheck`
  );
}

// Close specific connection
export async function deleteConnection(id: string) {
  const instance = await getAxios();
  await instance.delete<any, any>(`/connections/${encodeURIComponent(id)}`);
}

// Close all connections
export async function closeAllConnections() {
  const instance = await getAxios();
  await instance.delete<any, any>(`/connections`);
}
