/**
 * 配置缓存集成 Hook
 */
import { useEffect } from 'react'

import {
  configCache,
  useCachedInitialData,
  useCacheSync,
  CACHE_KEYS,
  DEFAULT_TTL,
} from '@/services/config-cache'

/**
 * Hook: 集成 useVerge 的缓存
 *
 * 使用方法:
 * ```typescript
 * const { verge } = useVerge()
 * useCachedVerge(verge)
 * ```
 */
export function useCachedVerge(verge: IVergeConfig | undefined) {
  useCacheSync(CACHE_KEYS.VERGE_CONFIG, verge, DEFAULT_TTL.CONFIG)
}

/**
 * Hook: 集成代理列表的缓存
 */
export function useCachedProxies(proxies: any | undefined) {
  useCacheSync(CACHE_KEYS.PROXIES, proxies, DEFAULT_TTL.PROXIES)
}

/**
 * Hook: 集成规则的缓存
 */
export function useCachedRules(rules: any | undefined) {
  useCacheSync(CACHE_KEYS.RULES, rules, DEFAULT_TTL.RULES)
}

/**
 * Hook: 集成 Clash 配置的缓存
 */
export function useCachedClashConfig(config: any | undefined) {
  useCacheSync(CACHE_KEYS.CLASH_CONFIG, config, DEFAULT_TTL.CONFIG)
}

/**
 * Hook: 获取缓存统计并定期打印
 */
export function useCacheStatsLogger(intervalMs: number = 60000) {
  useEffect(() => {
    const interval = setInterval(() => {
      configCache.printStats()
    }, intervalMs)

    return () => clearInterval(interval)
  }, [intervalMs])
}

/**
 * Hook: 监听缓存变化
 */
export function useOnCacheChange(key: string, callback: () => void) {
  useEffect(() => {
    const unsubscribe = configCache.onChange((changedKey) => {
      if (changedKey === key) {
        callback()
      }
    })

    return unsubscribe
  }, [key, callback])
}

/**
 * Hook: 获取初始缓存数据用于 useQuery
 */
export function useProxiesCachedInitial() {
  return useCachedInitialData(CACHE_KEYS.PROXIES)
}

export function useRulesCachedInitial() {
  return useCachedInitialData(CACHE_KEYS.RULES)
}

export function useClashConfigCachedInitial() {
  return useCachedInitialData(CACHE_KEYS.CLASH_CONFIG)
}

export function useVergeCachedInitial() {
  return useCachedInitialData(CACHE_KEYS.VERGE_CONFIG)
}
