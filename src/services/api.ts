import { getName, getVersion } from "@tauri-apps/api/app";
import { fetch } from "@tauri-apps/plugin-http";
import { asyncRetry } from "foxts/async-retry";
import { extractErrorMessage } from "foxts/extract-error-message";
import { once } from "foxts/once";

import { debugLog } from "@/utils/debug";

const getUserAgentPromise = once(async () => {
  try {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    return `${name}/${version}`;
  } catch (error) {
    console.debug("Failed to build User-Agent, fallback to default", error);
    return "clash-verge-rev";
  }
});
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

// 获取当前IP和地理位置信息
export const getIpInfo = async (): Promise<
  IpInfo & { lastFetchTs: number }
> => {
  // 配置参数
  const maxRetries = 2;
  const serviceTimeout = 5000;

  const shuffledServices = IP_CHECK_SERVICES.toSorted(
    () => Math.random() - 0.5,
  );
  let lastError: unknown | null = null;
  const userAgent = await getUserAgentPromise();
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

          let data: any;
          try {
            data = await response.json();
          } catch {
            return bail(new Error(`无法解析 JSON 响应 from ${service.url}`));
          }

          if (data && data.ip) {
            debugLog(`IP检测成功，使用服务: ${service.url}`);
            return Object.assign(service.mapping(data), {
              // use last fetch success timestamp
              lastFetchTs: Date.now(),
            });
          } else {
            return bail(new Error(`无效的响应格式 from ${service.url}`));
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
