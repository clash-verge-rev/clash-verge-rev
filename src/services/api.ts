import { getName, getVersion } from "@tauri-apps/api/app";
import { fetch } from "@tauri-apps/plugin-http";
import { asyncRetry } from "foxts/async-retry";
import { extractErrorMessage } from "foxts/extract-error-message";

import { debugLog } from "@/utils/debug";

let cachedUserAgent: string | null = null;

async function getUserAgent(): Promise<string> {
  if (cachedUserAgent) return cachedUserAgent;

  try {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    cachedUserAgent = `${name}/${version}`;
  } catch (error) {
    console.debug("Failed to build User-Agent, fallback to default", error);
    cachedUserAgent = "clash-verge-rev";
  }

  return cachedUserAgent;
}

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
  {
    url: "https://ip.api.skk.moe/cf-geoip",
    mapping: (data) => ({
      ip: data.ip || "",
      country_code: data.country || "",
      country: data.country || "",
      region: data.region || "",
      city: data.city || "",
      organization: data.asOrg || "",
      asn: data.asn || 0,
      asn_organization: data.asOrg || "",
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone || "",
    }),
  },
  {
    url: "https://get.geojs.io/v1/ip/geo.json",
    mapping: (data) => ({
      ip: data.ip || "",
      country_code: data.country_code || "",
      country: data.country || "",
      region: data.region || "",
      city: data.city || "",
      organization: data.organization_name || "",
      asn: data.asn || 0,
      asn_organization: data.organization_name || "",
      longitude: Number(data.longitude) || 0,
      latitude: Number(data.latitude) || 0,
      timezone: data.timezone || "",
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
export const getIpInfo = async (): Promise<
  IpInfo & { lastFetchTs: number }
> => {
  // 配置参数
  const maxRetries = 2;
  const serviceTimeout = 5000;

  const shuffledServices = shuffleServices();
  let lastError: unknown | null = null;
  const userAgent = await getUserAgent();
  console.debug("User-Agent for IP detection:", userAgent);

  for (const service of shuffledServices) {
    debugLog(`尝试IP检测服务: ${service.url}`);

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, service.timeout || serviceTimeout);

    try {
      return await asyncRetry(
        async (bail) => {
          console.debug("Fetching IP information:", service.url);

          const response = await fetch(service.url, {
            method: "GET",
            signal: timeoutController.signal, // AbortSignal.timeout(service.timeout || serviceTimeout),
            connectTimeout: service.timeout || serviceTimeout,
            headers: {
              "User-Agent": userAgent,
            },
          });

          if (!response.ok) {
            return bail(
              new Error(
                `IP 检测服务出错，状态码: ${response.status} from ${service.url}`,
              ),
            );
          }

          const data = await response.json();

          if (data && data.ip) {
            debugLog(`IP检测成功，使用服务: ${service.url}`);
            return Object.assign(service.mapping(data), {
              // use last fetch success timestamp
              lastFetchTs: Date.now(),
            });
          } else {
            throw new Error(`无效的响应格式 from ${service.url}`);
          }
        },
        {
          retries: maxRetries,
          minTimeout: 1000,
          maxTimeout: 4000,
          randomize: true,
        },
      );
    } catch (error) {
      debugLog(`IP检测服务失败: ${service.url}`, error);
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastError) {
    throw new Error(
      `所有IP检测服务都失败: ${extractErrorMessage(lastError) || "未知错误"}`,
    );
  } else {
    throw new Error("没有可用的IP检测服务");
  }
};
