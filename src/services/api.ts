import axios, { AxiosInstance } from "axios";
import { invoke } from "@tauri-apps/api/core";
import { getClashInfo } from "./cmds";

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
