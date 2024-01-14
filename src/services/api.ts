import { getClashInfo } from "./cmds";
import {
  fetch as tauriFetch,
  HttpVerb,
  Body,
  Response,
} from "@tauri-apps/api/http";
let clashInfo: IClashInfo | null;

export const refreshClashInfo = async () => {
  clashInfo = await getClashInfo();
  return clashInfo;
};

export const fetch = async (
  path: string,
  method: HttpVerb,
  body?: any
): Promise<Response<any>> => {
  let server = "";
  let secret = "";

  try {
    const info = clashInfo ?? (await refreshClashInfo());

    if (info?.server) {
      server = info.server;
      // compatible width `external-controller`
      if (server.startsWith(":")) server = `127.0.0.1${server}`;
      else if (/^\d+$/.test(server)) server = `127.0.0.1:${server}`;
    }
    if (info?.secret) secret = info?.secret;
  } catch {}

  return tauriFetch(`http://${server}${path}`, {
    method,
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    timeout: 15000,
    body: body ? Body.json(body) : undefined,
  });
};

/// Get Version
export const getVersion = async () => {
  const res = await fetch("/version", "GET");
  return res.data as Promise<{
    premium: boolean;
    meta?: boolean;
    version: string;
  }>;
};

/// Get current base configs
export const getClashConfig = async () => {
  const res = await fetch("/configs", "GET");
  return res.data as Promise<IConfigData>;
};

/// Update current configs
export const updateConfigs = async (config: Partial<IConfigData>) => {
  const res = await fetch("/configs", "PATCH", config);
  return res;
};

/// Update geo data
export const updateGeoData = async () => {
  const res = await fetch("/configs/geo", "POST");
  return res;
};

/// Upgrade clash core
export const upgradeCore = async () => {
  const res = await fetch("/upgrade", "POST");
  return res;
};

/// Get current rules
export const getRules = async () => {
  const res = await fetch("/rules", "GET");
  return res?.data?.rules as IRuleItem[];
};

/// Get Proxy delay
export const getProxyDelay = async (name: string, url?: string) => {
  const params = {
    timeout: 10000,
    url: url || "http://1.1.1.1",
  };
  const result = await fetch(
    `/proxies/${encodeURIComponent(name)}/delay`,
    "GET",
    { params }
  );
  return result.data as any as { delay: number };
};

/// Update the Proxy Choose
export const updateProxy = async (group: string, proxy: string) => {
  const res = await fetch(`/proxies/${encodeURIComponent(group)}`, "PUT", {
    name: proxy,
  });
  return res;
};

// get proxy
export const getProxiesInner = async () => {
  const res = await fetch("/proxies", "GET");
  return (res?.data?.proxies || {}) as Record<string, IProxyItem>;
};

/// Get the Proxy information
export const getProxies = async () => {
  const [proxyRecord, providerRecord] = await Promise.all([
    getProxiesInner(),
    getProviders(),
  ]);

  // provider name map
  const providerMap = Object.fromEntries(
    Object.entries(providerRecord).flatMap(([provider, item]) =>
      item.proxies.map((p) => [p.name, { ...p, provider }])
    )
  );

  // compatible with proxy-providers
  const generateItem = (name: string) => {
    if (proxyRecord[name]) return proxyRecord[name];
    if (providerMap[name]) return providerMap[name];
    return {
      name,
      type: "unknown",
      udp: false,
      xudp: false,
      tfo: false,
      history: [],
    };
  };

  const { GLOBAL: global, DIRECT: direct, REJECT: reject } = proxyRecord;

  let groups: IProxyGroupItem[] = [];

  if (global?.all) {
    groups = global.all
      .filter((name) => proxyRecord[name]?.all)
      .map((name) => proxyRecord[name])
      .map((each) => ({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      }));
  } else {
    groups = Object.values(proxyRecord)
      .filter((each) => each.name !== "GLOBAL" && each.all)
      .map((each) => ({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  const proxies = [direct, reject].concat(
    Object.values(proxyRecord).filter(
      (p) => !p.all?.length && p.name !== "DIRECT" && p.name !== "REJECT"
    )
  );

  const _global: IProxyGroupItem = {
    ...global,
    all: global?.all?.map((item) => generateItem(item)) || [],
  };

  return { global: _global, direct, groups, records: proxyRecord, proxies };
};

// get proxy providers
export const getProviders = async () => {
  const res = await fetch("/providers/proxies", "GET");
  const providers = (res.data.providers || {}) as Record<string, IProviderItem>;

  return Object.fromEntries(
    Object.entries(providers).filter(([key, item]) => {
      const type = item.vehicleType.toLowerCase();
      return type === "http" || type === "file";
    })
  );
};

// proxy providers health check
export const providerHealthCheck = async (name: string) => {
  const res = await fetch(
    `/providers/proxies/${encodeURIComponent(name)}/healthcheck`,
    "GET"
  );
  return res;
};

export const providerUpdate = async (name: string) => {
  const res = await fetch(
    `/providers/proxies/${encodeURIComponent(name)}`,
    "PUT"
  );
  return res;
};

export const getConnections = async () => {
  const res = await fetch("/connections", "GET");
  return res.data as any as IConnections;
};

// Close specific connection
export const deleteConnection = async (id: string) => {
  const res = await fetch(`/connections/${encodeURIComponent(id)}`, "DELETE");
  return res;
};

// Close all connections
export const closeAllConnections = async () => {
  const res = await fetch("/connections", "DELETE");
  return res;
};
