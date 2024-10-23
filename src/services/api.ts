import axios, { AxiosInstance } from "axios";
import { getClashInfo } from "./cmds";

let axiosIns: AxiosInstance = null!;

/// initialize some information
/// enable force update axiosIns
export const getAxios = async (force: boolean = false) => {
  if (axiosIns && !force) return axiosIns;

  let server = "";
  let secret = "";

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
    timeout: 15000,
  });
  axiosIns.interceptors.response.use((r) => r.data);
  return axiosIns;
};

/// Get Version
export const getVersion = async () => {
  const instance = await getAxios();
  return instance.get("/version") as Promise<{
    premium: boolean;
    meta?: boolean;
    version: string;
  }>;
};

/// Get current base configs
export const getClashConfig = async () => {
  const instance = await getAxios();
  return instance.get("/configs") as Promise<IConfigData>;
};

/// Update current configs
// export const updateConfigs = async (config: Partial<IConfigData>) => {
//   const instance = await getAxios();
//   return instance.patch("/configs", config);
// };

/// Update geo data
export const updateGeoData = async () => {
  const instance = await getAxios();
  return instance.post("/configs/geo");
};

/// Upgrade clash core
export const upgradeCore = async () => {
  const instance = await getAxios();
  return instance.post("/upgrade", {}, { timeout: 0 });
};

/// Get current rules
export const getRules = async () => {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/rules");
  return response?.rules as IRuleItem[];
};

/// Get Proxy delay
export const getProxyDelay = async (
  name: string,
  url?: string,
  timeout?: number,
) => {
  const params = {
    timeout: timeout || 5000,
    url: url || "https://www.gstatic.com/generate_204",
  };
  const instance = await getAxios();
  const result = await instance.get(
    `/proxies/${encodeURIComponent(name)}/delay`,
    { params },
  );
  return result as unknown as { delay: number };
};

/// Update the Proxy Choose
export const updateProxy = async (group: string, proxy: string) => {
  const instance = await getAxios();
  return instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy });
};

// get proxy
export const getProxiesInner = async () => {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/proxies");
  return (response?.proxies || {}) as Record<string, IProxyItem>;
};

/// Get the Proxy information
export const getProxies = async () => {
  const [proxyRecord, providerRecord] = await Promise.all([
    getProxiesInner(),
    getProxyProviders(),
  ]);
  // provider name map
  const providerMap = Object.fromEntries(
    Object.entries(providerRecord).flatMap(([provider, item]) =>
      item.proxies.map((p) => [p.name, { ...p, provider }]),
    ),
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

  let groups: IProxyGroupItem[] = Object.values(proxyRecord).reduce<
    IProxyGroupItem[]
  >((acc, each) => {
    if (each.name !== "GLOBAL" && each.all) {
      acc.push({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      });
    }

    return acc;
  }, []);

  if (global?.all) {
    let globalGroups: IProxyGroupItem[] = global.all.reduce<IProxyGroupItem[]>(
      (acc, name) => {
        if (proxyRecord[name]?.all) {
          acc.push({
            ...proxyRecord[name],
            all: proxyRecord[name].all!.map((item) => generateItem(item)),
          });
        }
        return acc;
      },
      [],
    );

    let globalNames = new Set(globalGroups.map((each) => each.name));
    groups = groups
      .filter((group) => {
        return !globalNames.has(group.name);
      })
      .concat(globalGroups);
  }

  const proxies = [direct, reject].concat(
    Object.values(proxyRecord).filter(
      (p) => !p.all?.length && p.name !== "DIRECT" && p.name !== "REJECT",
    ),
  );

  const _global: IProxyGroupItem = {
    ...global,
    all: global?.all?.map((item) => generateItem(item)) || [],
  };

  return { global: _global, direct, groups, records: proxyRecord, proxies };
};

// get proxy providers
export const getProxyProviders = async () => {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/providers/proxies");

  const providers = (response.providers || {}) as Record<
    string,
    IProxyProviderItem
  >;

  return Object.fromEntries(
    Object.entries(providers).filter(([key, item]) => {
      const type = item.vehicleType.toLowerCase();
      return type === "http" || type === "file";
    }),
  );
};

export const getRuleProviders = async () => {
  const instance = await getAxios();
  const response = await instance.get<any, any>("/providers/rules");

  const providers = (response.providers || {}) as Record<
    string,
    IRuleProviderItem
  >;

  return Object.fromEntries(
    Object.entries(providers).filter(([key, item]) => {
      const type = item.vehicleType.toLowerCase();
      return type === "http" || type === "file";
    }),
  );
};

// proxy providers health check
export const providerHealthCheck = async (name: string) => {
  const instance = await getAxios();
  return instance.get(
    `/providers/proxies/${encodeURIComponent(name)}/healthcheck`,
  );
};

export const proxyProviderUpdate = async (name: string) => {
  const instance = await getAxios();
  return instance.put(`/providers/proxies/${encodeURIComponent(name)}`);
};

export const ruleProviderUpdate = async (name: string) => {
  const instance = await getAxios();
  return instance.put(`/providers/rules/${encodeURIComponent(name)}`);
};

export const getConnections = async () => {
  const instance = await getAxios();
  const result = await instance.get("/connections");
  return result as unknown as IConnections;
};

// Close specific connection
export const deleteConnection = async (id: string) => {
  const instance = await getAxios();
  await instance.delete<any, any>(`/connections/${encodeURIComponent(id)}`);
};

// Close all connections
export const closeAllConnections = async () => {
  const instance = await getAxios();
  await instance.delete<any, any>(`/connections`);
};

// Get Group Proxy Delays
export const getGroupProxyDelays = async (
  groupName: string,
  url?: string,
  timeout?: number,
) => {
  const params = {
    timeout: timeout || 5000,
    url: url || "https://www.gstatic.com/generate_204",
  };
  const instance = await getAxios();
  const result = await instance.get(
    `/group/${encodeURIComponent(groupName)}/delay`,
    { params },
  );
  return result as unknown as Record<string, number>;
};

// clear fakeip cache
export const flushFakeipCache = async () => {
  const instance = await getAxios();
  await instance.post("/cache/fakeip/flush");
};
