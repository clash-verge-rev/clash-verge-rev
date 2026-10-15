import { getName, getVersion } from '@tauri-apps/api/app'
import { fetch } from '@tauri-apps/plugin-http'
import { asyncRetry } from 'foxts/async-retry'
import { extractErrorMessage } from 'foxts/extract-error-message'
import { once } from 'foxts/once'
import i18n from 'i18next'

import { debugLog } from '@/utils/debug'

const getUserAgentPromise = once(async () => {
  try {
    const [name, version] = await Promise.all([getName(), getVersion()])
    return `${name}/${version}`
  } catch (error) {
    console.debug('Failed to build User-Agent, fallback to default', error)
    return 'clash-verge-rev'
  }
})
// Get current IP and geolocation information （refactored IP detection with service-specific mappings）
interface IpInfo {
  ip: string
  country_code: string
  country: string
  region: string
  city: string
  organization: string
  asn: number
  asn_organization: string
  longitude: number
  latitude: number
  timezone: string
}

// IP检测服务配置
interface ServiceConfig {
  url: string
  mapping: (data: any) => IpInfo
  timeout?: number // 保留timeout字段（如有需要）
}

// 可用的IP检测服务列表及字段映射
const IP_CHECK_SERVICES: ServiceConfig[] = [
  {
    url: 'https://api.ip.sb/geoip',
    mapping: (data) => ({
      ip: data.ip || '',
      country_code: data.country_code || '',
      country: data.country || '',
      region: data.region || '',
      city: data.city || '',
      organization: data.organization || data.isp || '',
      asn: data.asn || 0,
      asn_organization: data.asn_organization || '',
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone || '',
    }),
  },
  {
    url: 'https://ipapi.co/json',
    mapping: (data) => ({
      ip: data.ip || '',
      country_code: data.country_code || '',
      country: data.country_name || '',
      region: data.region || '',
      city: data.city || '',
      organization: data.org || '',
      asn: data.asn ? parseInt(data.asn.replace('AS', ''), 10) : 0,
      asn_organization: data.org || '',
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone || '',
    }),
  },
  {
    url: 'https://api.ipapi.is/',
    mapping: (data) => ({
      ip: data.ip || '',
      country_code: data.location?.country_code || '',
      country: data.location?.country || '',
      region: data.location?.state || '',
      city: data.location?.city || '',
      organization: data.asn?.org || data.company?.name || '',
      asn: data.asn?.asn || 0,
      asn_organization: data.asn?.org || '',
      longitude: data.location?.longitude || 0,
      latitude: data.location?.latitude || 0,
      timezone: data.location?.timezone || '',
    }),
  },
  {
    url: 'https://ipwho.is/',
    mapping: (data) => ({
      ip: data.ip || '',
      country_code: data.country_code || '',
      country: data.country || '',
      region: data.region || '',
      city: data.city || '',
      organization: data.connection?.org || data.connection?.isp || '',
      asn: data.connection?.asn || 0,
      asn_organization: data.connection?.isp || '',
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone?.id || '',
    }),
  },
  {
    url: 'https://ip.api.skk.moe/cf-geoip',
    mapping: (data) => ({
      ip: data.ip || '',
      country_code: data.country || '',
      country: data.country || '',
      region: data.region || '',
      city: data.city || '',
      organization: data.asOrg || '',
      asn: data.asn || 0,
      asn_organization: data.asOrg || '',
      longitude: data.longitude || 0,
      latitude: data.latitude || 0,
      timezone: data.timezone || '',
    }),
  },
  {
    url: 'https://get.geojs.io/v1/ip/geo.json',
    mapping: (data) => ({
      ip: data.ip || '',
      country_code: data.country_code || '',
      country: data.country || '',
      region: data.region || '',
      city: data.city || '',
      organization: data.organization_name || '',
      asn: data.asn || 0,
      asn_organization: data.organization_name || '',
      longitude: Number(data.longitude) || 0,
      latitude: Number(data.latitude) || 0,
      timezone: data.timezone || '',
    }),
  },
]

// 结果缓存：10 分钟内不重复发起 IP 检测请求（并发后请求量更大，缓存兜底限流）
const IP_INFO_CACHE_TTL_MS = 10 * 60 * 1000
let ipInfoCache: (IpInfo & { lastFetchTs: number }) | null = null

// 获取当前IP和地理位置信息
export const getIpInfo = async (): Promise<
  IpInfo & { lastFetchTs: number }
> => {
  if (
    ipInfoCache &&
    Date.now() - ipInfoCache.lastFetchTs < IP_INFO_CACHE_TTL_MS
  ) {
    return ipInfoCache
  }

  // 配置参数
  const maxRetries = 2
  const serviceTimeout = 5000

  const shuffledServices = IP_CHECK_SERVICES.slice().sort(
    () => Math.random() - 0.5,
  )
  if (shuffledServices.length === 0) {
    throw new Error(i18n.t(($) => $.home.components.ipInfo.errors.noServices))
  }
  const userAgent = await getUserAgentPromise()
  console.debug('User-Agent for IP detection:', userAgent)

  // 所有服务并发发起（各自带重试），首个成功即返回；
  // 相比串行逐个尝试，最坏耗时从 sum(6×(1+2)×5s) 收敛到单服务上限
  const attempts = shuffledServices.map(async (service) => {
    debugLog(`尝试IP检测服务: ${service.url}`)

    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => {
      timeoutController.abort()
    }, service.timeout || serviceTimeout)

    try {
      return await asyncRetry(
        async (bail) => {
          console.debug('Fetching IP information:', service.url)

          const response = await fetch(service.url, {
            method: 'GET',
            signal: timeoutController.signal, // AbortSignal.timeout(service.timeout || serviceTimeout),
            connectTimeout: service.timeout || serviceTimeout,
            headers: {
              'User-Agent': userAgent,
            },
          })

          if (!response.ok) {
            return bail(
              new Error(
                `IP 检测服务出错，状态码: ${response.status} from ${service.url}`,
              ),
            )
          }

          let data: any
          try {
            data = await response.json()
          } catch {
            return bail(new Error(`无法解析 JSON 响应 from ${service.url}`))
          }

          if (data?.ip) {
            debugLog(`IP检测成功，使用服务: ${service.url}`)
            return Object.assign(service.mapping(data), {
              // use last fetch success timestamp
              lastFetchTs: Date.now(),
            })
          } else {
            return bail(new Error(`无效的响应格式 from ${service.url}`))
          }
        },
        {
          retries: maxRetries,
          minTimeout: 1000,
          maxTimeout: 4000,
          randomize: true,
        },
      )
    } catch (error) {
      debugLog(`IP检测服务失败: ${service.url}`, error)
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  })

  try {
    const result = await Promise.any(attempts)
    ipInfoCache = result
    return result
  } catch (error) {
    console.error('[IP Info] All detection services failed:', error)
    const reasons =
      error instanceof AggregateError
        ? error.errors.map(extractErrorMessage).filter(Boolean).join('; ')
        : extractErrorMessage(error)
    throw new Error(
      i18n.t(($) => $.home.components.ipInfo.errors.loadWithDetails, {
        message: reasons || i18n.t(($) => $.shared.feedback.errors.unknown),
      }),
    )
  }
}
