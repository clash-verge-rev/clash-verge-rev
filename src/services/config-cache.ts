/**
 * 配置缓存系统 - 减少重复的文件 I/O 和 YAML 解析
 *
 * 策略:
 * 1. 内存缓存所有解析过的配置
 * 2. 监听配置变化事件自动失效缓存
 * 3. 支持手动失效特定缓存项
 */

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl?: number // 生存时间（毫秒），undefined 表示不过期
}

export interface CacheStats {
  hits: number
  misses: number
  size: number
  entries: string[]
}

class ConfigCache {
  private cache = new Map<string, CacheEntry<any>>()
  private stats = {
    hits: 0,
    misses: 0,
  }
  private invalidateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private changeListeners = new Set<(key: string) => void>()

  /**
   * 获取缓存数据
   */
  get<T = any>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }

    // 检查是否已过期
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      this.clearInvalidateTimer(key)
      this.stats.misses++
      return undefined
    }

    this.stats.hits++
    return entry.data as T
  }

  /**
   * 设置缓存数据
   */
  set<T = any>(key: string, data: T, ttl?: number): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    }
    this.cache.set(key, entry)

    // 如果设置了 TTL，自动失效
    if (ttl) {
      this.setInvalidateTimer(key, ttl)
    }

    console.debug(`[ConfigCache] Set cache: ${key} (ttl: ${ttl}ms)`)
  }

  /**
   * 立即失效缓存
   */
  invalidate(key: string): boolean {
    const hasKey = this.cache.has(key)
    if (hasKey) {
      this.cache.delete(key)
      this.clearInvalidateTimer(key)
      console.debug(`[ConfigCache] Invalidated: ${key}`)
      this.notifyChange(key)
    }
    return hasKey
  }

  /**
   * 失效所有缓存
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    this.invalidateTimers.forEach((timer) => clearTimeout(timer))
    this.invalidateTimers.clear()
    console.debug(`[ConfigCache] Cleared ${size} cache entries`)
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }

  /**
   * 打印缓存统计
   */
  printStats(): void {
    const stats = this.getStats()
    const hitRate = stats.hits + stats.misses > 0
      ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2)
      : '0.00'

    console.group('📊 Config Cache Statistics')
    console.log(`Hit Rate: ${hitRate}% (${stats.hits} hits, ${stats.misses} misses)`)
    console.log(`Cached Entries: ${stats.size}`)
    console.table(stats.entries)
    console.groupEnd()
  }

  /**
   * 监听缓存变化
   */
  onChange(callback: (key: string) => void): () => void {
    this.changeListeners.add(callback)
    return () => this.changeListeners.delete(callback)
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats.hits = 0
    this.stats.misses = 0
    console.debug('[ConfigCache] Stats reset')
  }

  /**
   * 内部：设置自动失效定时器
   */
  private setInvalidateTimer(key: string, ttl: number): void {
    this.clearInvalidateTimer(key)
    const timer = setTimeout(() => {
      this.invalidate(key)
    }, ttl)
    this.invalidateTimers.set(key, timer)
  }

  /**
   * 内部：清除自动失效定时器
   */
  private clearInvalidateTimer(key: string): void {
    const timer = this.invalidateTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.invalidateTimers.delete(key)
    }
  }

  /**
   * 内部：通知变化监听器
   */
  private notifyChange(key: string): void {
    this.changeListeners.forEach((callback) => {
      try {
        callback(key)
      } catch (error) {
        console.error('[ConfigCache] Change listener error:', error)
      }
    })
  }
}

// 全局缓存实例
export const configCache = new ConfigCache()

/**
 * 缓存键常量
 */
export const CACHE_KEYS = {
  // Verge 配置
  VERGE_CONFIG: 'verge_config',

  // Clash 运行时配置
  CLASH_CONFIG: 'clash_config',

  // 代理相关
  PROXIES: 'proxies',
  PROXY_PROVIDERS: 'proxy_providers',
  PROXY_GROUPS: 'proxy_groups',

  // 规则相关
  RULES: 'rules',
  RULE_PROVIDERS: 'rule_providers',

  // 系统信息
  SYSTEM_PROXY: 'system_proxy',
  SYSTEM_INFO: 'system_info',
  RUNNING_MODE: 'running_mode',

  // 其他
  APP_UPTIME: 'app_uptime',
} as const

/**
 * 默认 TTL（生存时间）配置
 */
export const DEFAULT_TTL = {
  // 配置信息 - 长期有效
  CONFIG: 5 * 60 * 1000, // 5 分钟

  // 代理和规则 - 中期有效
  PROXIES: 90 * 1000, // 90 秒
  RULES: 2 * 60 * 1000, // 2 分钟

  // 系统信息 - 短期有效
  SYSTEM: 30 * 1000, // 30 秒

  // 实时数据 - 不缓存
  REALTIME: undefined,
} as const

/**
 * 便利函数：获取缓存的 Verge 配置
 */
export function getCachedVergeConfig(): IVergeConfig | undefined {
  return configCache.get(CACHE_KEYS.VERGE_CONFIG)
}

/**
 * 便利函数：设置缓存的 Verge 配置
 */
export function setCachedVergeConfig(config: IVergeConfig): void {
  configCache.set(CACHE_KEYS.VERGE_CONFIG, config, DEFAULT_TTL.CONFIG)
}

/**
 * 便利函数：获取缓存的代理列表
 */
export function getCachedProxies(): any | undefined {
  return configCache.get(CACHE_KEYS.PROXIES)
}

/**
 * 便利函数：设置缓存的代理列表
 */
export function setCachedProxies(proxies: any): void {
  configCache.set(CACHE_KEYS.PROXIES, proxies, DEFAULT_TTL.PROXIES)
}

/**
 * 便利函数：获取缓存的规则
 */
export function getCachedRules(): any | undefined {
  return configCache.get(CACHE_KEYS.RULES)
}

/**
 * 便利函数：设置缓存的规则
 */
export function setCachedRules(rules: any): void {
  configCache.set(CACHE_KEYS.RULES, rules, DEFAULT_TTL.RULES)
}

/**
 * Hook: 缓存数据同步
 *
 * 使用方法:
 * ```typescript
 * const { data: proxies } = useQuery({...})
 * useCacheSync('proxies', proxies, DEFAULT_TTL.PROXIES)
 * ```
 */
export function useCacheSync<T>(key: string, data: T | undefined, ttl?: number): void {
  React.useEffect(() => {
    if (data !== undefined) {
      configCache.set(key, data, ttl)
    }
  }, [key, data, ttl])
}

/**
 * Hook: 从缓存获取初始数据
 *
 * 使用方法:
 * ```typescript
 * const initialData = useCachedInitialData('proxies')
 * const { data: proxies } = useQuery({
 *   initialData,
 *   ...
 * })
 * ```
 */
export function useCachedInitialData<T = any>(key: string): T | undefined {
  return React.useMemo(() => configCache.get<T>(key), [key])
}

import React from 'react'
