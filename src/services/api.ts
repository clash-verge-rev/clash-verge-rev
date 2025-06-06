import axios, { AxiosInstance } from "axios";
import { getClashInfo } from "./cmds";
import { invoke } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";

let instancePromise: Promise<AxiosInstance> = null!;

async function getInstancePromise() {
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

  const axiosIns = axios.create({
    baseURL: `http://${server}`,
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    timeout: 15000,
  });
  axiosIns.interceptors.response.use((r) => r.data);
  return axiosIns;
}

/// initialize some information
/// enable force update axiosIns
export const getAxios = async (force: boolean = false) => {
  if (!instancePromise || force) {
    instancePromise = getInstancePromise();
  }
  return instancePromise;
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

/// Update geo data
export const updateGeoData = async () => {
  const instance = await getAxios();
  return instance.post("/configs/geo");
};

/// Upgrade clash core
export const upgradeCore = async () => {
  const instance = await getAxios();
  return instance.post("/upgrade");
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
    timeout: timeout || 10000,
    url: url || "https://cp.cloudflare.com/generate_204",
  };
  const instance = await getAxios();
  const result = await instance.get(
    `/proxies/${encodeURIComponent(name)}/delay`,
    { params },
  );
  return result as any as { delay: number };
};

/// Update the Proxy Choose
export const updateProxy = async (group: string, proxy: string) => {
  const instance = await getAxios();
  return instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy });
};

// get proxy
export const getProxiesInner = async () => {
  const response = await invoke<{ proxies: Record<string, IProxyItem> }>(
    "get_proxies",
  );
  return response.proxies as Record<string, IProxyItem>;
};

/// Get the Proxy information
export const getProxies = async (): Promise<{
  global: IProxyGroupItem;
  direct: IProxyItem;
  groups: IProxyGroupItem[];
  records: Record<string, IProxyItem>;
  proxies: IProxyItem[];
}> => {
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
      mptcp: false,
      smux: false,
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
  const response = await invoke<{
    providers: Record<string, IProxyProviderItem>;
  }>("get_providers_proxies");
  if (!response || !response.providers) {
    console.warn(
      "getProxyProviders: Invalid response structure, returning empty object",
    );
    return {};
  }

  const providers = response.providers as Record<string, IProxyProviderItem>;

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
  return result as any as IConnections;
};

// Close specific connection
export const deleteConnection = async (id: string) => {
  const instance = await getAxios();
  await instance.delete<any, any>(`/connections/${encodeURIComponent(id)}`);
};

// Close all connections
export const closeAllConnections = async () => {
  const instance = await getAxios();
  await instance.delete("/connections");
};

// Get Group Proxy Delays
export const getGroupProxyDelays = async (
  groupName: string,
  url?: string,
  timeout?: number,
) => {
  const params = {
    timeout: timeout || 10000,
    url: url || "https://cp.cloudflare.com/generate_204",
  };

  console.log(
    `[API] 获取代理组延迟，组: ${groupName}, URL: ${params.url}, 超时: ${params.timeout}ms`,
  );

  try {
    const instance = await getAxios();
    console.log(
      `[API] 发送HTTP请求: GET /group/${encodeURIComponent(groupName)}/delay`,
    );

    const result = await instance.get(
      `/group/${encodeURIComponent(groupName)}/delay`,
      { params },
    );

    console.log(
      `[API] 获取代理组延迟成功，组: ${groupName}, 结果数量:`,
      Object.keys(result || {}).length,
    );
    return result as any as Record<string, number>;
  } catch (error) {
    console.error(`[API] 获取代理组延迟失败，组: ${groupName}`, error);
    throw error;
  }
};

// Is debug enabled
export const isDebugEnabled = async () => {
  try {
    const instance = await getAxios();
    await instance.get("/debug/pprof");
    return true;
  } catch {
    return false;
  }
};

// GC
export const gc = async () => {
  try {
    const instance = await getAxios();
    await instance.put("/debug/gc");
  } catch (error) {
    console.error(`Error gcing: ${error}`);
  }
};

// Get current IP and geolocation information （refactored IP detection with service-specific mappings）
interface IpInfo {
  ip: string;
  country_code: string;
  country: string;
  region: string;
  city: string;
  organization: string;
  asn: number;
  asn_organization: string;
  longitude: number;
  latitude: number;
  timezone: string;
}

// IP检测服务配置
interface ServiceConfig {
  url: string;
  mapping: (data: any) => IpInfo;
  timeout?: number; // 保留timeout字段（如有需要）
}

// 可用的IP检测服务列表及字段映射
const IP_CHECK_SERVICES: ServiceConfig[] = [
  {
    url: "https://api.ip.sb/geoip",
    mapping: (data) => ({
      ip: data.ip || "",
      country_code: data.country_code || "",
      country: data.country || "",
      region: data.region || "",
      city: data.city || "",
      organization: data.organization || data.isp || "",
      asn: data.asn || 0,
      asn_organization: data.asn_organization || "",
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone || "",
    }),
  },
  {
    url: "https://ipapi.co/json",
    mapping: (data) => ({
      ip: data.ip || "",
      country_code: data.country_code || "",
      country: data.country_name || "",
      region: data.region || "",
      city: data.city || "",
      organization: data.org || "",
      asn: data.asn ? parseInt(data.asn.replace("AS", "")) : 0,
      asn_organization: data.org || "",
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone || "",
    }),
  },
  {
    url: "https://api.ipapi.is/",
    mapping: (data) => ({
      ip: data.ip || "",
      country_code: data.location?.country_code || "",
      country: data.location?.country || "",
      region: data.location?.state || "",
      city: data.location?.city || "",
      organization: data.asn?.org || data.company?.name || "",
      asn: data.asn?.asn || 0,
      asn_organization: data.asn?.org || "",
      longitude: data.location?.longitude || 0,
      latitude: data.location?.latitude || 0,
      timezone: data.location?.timezone || "",
    }),
  },
  {
    url: "https://ipwho.is/",
    mapping: (data) => ({
      ip: data.ip || "",
      country_code: data.country_code || "",
      country: data.country || "",
      region: data.region || "",
      city: data.city || "",
      organization: data.connection?.org || data.connection?.isp || "",
      asn: data.connection?.asn || 0,
      asn_organization: data.connection?.isp || "",
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone?.id || "",
    }),
  },
];

// 随机性服务列表洗牌函数
function shuffleServices() {
  // 过滤无效服务并确保每个元素符合ServiceConfig接口
  const validServices = IP_CHECK_SERVICES.filter(
    (service): service is ServiceConfig =>
      service !== null &&
      service !== undefined &&
      typeof service.url === "string" &&
      typeof service.mapping === "function", // 添加对mapping属性的检查
  );

  if (validServices.length === 0) {
    console.error("No valid services found in IP_CHECK_SERVICES");
    return [];
  }

  // 使用单一Fisher-Yates洗牌算法，增强随机性
  const shuffled = [...validServices];
  const length = shuffled.length;

  // 使用多个种子进行多次洗牌
  const seeds = [Math.random(), Date.now() / 1000, performance.now() / 1000];

  for (const seed of seeds) {
    const prng = createPrng(seed);

    // Fisher-Yates洗牌算法
    for (let i = length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));

      // 使用临时变量进行交换，避免解构赋值可能的问题
      const temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }
  }

  return shuffled;
}

// 创建一个简单的随机数生成器
function createPrng(seed: number): () => number {
  // 使用xorshift32算法
  let state = seed >>> 0;

  // 如果种子为0，设置一个默认值
  if (state === 0) state = 123456789;

  return function () {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

// 获取当前IP和地理位置信息
export const getIpInfo = async (): Promise<IpInfo> => {
  // 配置参数
  const maxRetries = 3;
  const serviceTimeout = 5000;
  const overallTimeout = 20000; // 增加总超时时间以容纳延迟

  const overallTimeoutController = new AbortController();
  const overallTimeoutId = setTimeout(() => {
    overallTimeoutController.abort();
  }, overallTimeout);

  try {
    const shuffledServices = shuffleServices();
    let lastError: Error | null = null;

    for (const service of shuffledServices) {
      console.log(`尝试IP检测服务: ${service.url}`);

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        try {
          const timeoutController = new AbortController();
          timeoutId = setTimeout(() => {
            timeoutController.abort();
          }, service.timeout || serviceTimeout);

          const response = await axios.get(service.url, {
            signal: timeoutController.signal,
            timeout: service.timeout || serviceTimeout,
            // 移除了headers参数（默认会使用axios的默认User-Agent）
          });

          if (timeoutId) clearTimeout(timeoutId);

          if (response.data && response.data.ip) {
            console.log(`IP检测成功，使用服务: ${service.url}`);
            return service.mapping(response.data);
          } else {
            throw new Error(`无效的响应格式 from ${service.url}`);
          }
        } catch (error: any) {
          if (timeoutId) clearTimeout(timeoutId);

          lastError = error;
          console.log(
            `尝试 ${attempt + 1}/${maxRetries} 失败 (${service.url}):`,
            error.message,
          );

          if (error.name === "AbortError") {
            throw error;
          }

          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    }

    if (lastError) {
      throw new Error(`所有IP检测服务都失败: ${lastError.message}`);
    } else {
      throw new Error("没有可用的IP检测服务");
    }
  } finally {
    clearTimeout(overallTimeoutId);
  }
};
