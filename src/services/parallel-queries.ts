/**
 * 并行数据查询优化 - 使用 Promise.all 批量获取多个数据源
 *
 * 用途:
 * - 应用启动时并行加载所有必需的数据
 * - 页面切换时并行刷新多个数据源
 * - 减少总加载时间
 */

import {
  getBaseConfig,
  getProxies,
  getRules,
  getRuleProviders,
} from 'tauri-plugin-mihomo-api'

import {
  getVergeConfig,
  getClashInfo,
  getProfiles,
} from '@/services/cmds'
import { recordIpcCall } from '@/services/performance-monitor'

export interface AppStartupData {
  vergeConfig: IVergeConfig | null
  clashInfo: IClashInfo | null
  profiles: IProfilesConfig | null
  baseConfig: any | null
  proxies: any | null
  rules: any | null
  ruleProviders: any | null
}

/**
 * 并行加载应用启动必需的所有数据
 *
 * 使用方法:
 * ```typescript
 * const data = await loadStartupDataInParallel()
 * ```
 *
 * 性能优势:
 * - 顺序加载: 总时间 = T1 + T2 + T3 + ... + Tn
 * - 并行加载: 总时间 = max(T1, T2, T3, ..., Tn)
 */
export async function loadStartupDataInParallel(): Promise<AppStartupData> {
  const startTime = performance.now()

  try {
    const [
      vergeConfig,
      clashInfo,
      profiles,
      baseConfig,
      proxies,
      rules,
      ruleProviders,
    ] = await Promise.all([
      getVergeConfig().catch((e) => {
        console.error('[Startup] Failed to load verge config:', e)
        return null
      }),
      getClashInfo().catch((e) => {
        console.error('[Startup] Failed to load clash info:', e)
        return null
      }),
      getProfiles().catch((e) => {
        console.error('[Startup] Failed to load profiles:', e)
        return null
      }),
      getBaseConfig().catch((e) => {
        console.error('[Startup] Failed to load base config:', e)
        return null
      }),
      getProxies().catch((e) => {
        console.error('[Startup] Failed to load proxies:', e)
        return null
      }),
      getRules().catch((e) => {
        console.error('[Startup] Failed to load rules:', e)
        return null
      }),
      getRuleProviders().catch((e) => {
        console.error('[Startup] Failed to load rule providers:', e)
        return null
      }),
    ])

    const duration = performance.now() - startTime
    recordIpcCall(duration)

    console.debug(
      `[Startup] Loaded 7 data sources in parallel: ${duration.toFixed(2)}ms`,
    )

    return {
      vergeConfig,
      clashInfo,
      profiles,
      baseConfig,
      proxies,
      rules,
      ruleProviders,
    }
  } catch (error) {
    console.error('[Startup] Parallel data loading failed:', error)
    throw error
  }
}

/**
 * 并行刷新多个查询
 *
 * 使用方法:
 * ```typescript
 * await refreshMultipleQueries([
 *   () => getProxies(),
 *   () => getBaseConfig(),
 *   () => getRules(),
 * ])
 * ```
 */
export async function refreshMultipleQueries<T = any>(
  queryFns: Array<() => Promise<T>>,
): Promise<T[]> {
  const startTime = performance.now()

  try {
    const results = await Promise.all(queryFns.map((fn) => fn().catch(() => null)))
    const duration = performance.now() - startTime

    recordIpcCall(duration / queryFns.length)

    console.debug(
      `[Parallel] Refreshed ${queryFns.length} queries in ${duration.toFixed(2)}ms`,
    )

    return results
  } catch (error) {
    console.error('[Parallel] Refresh failed:', error)
    throw error
  }
}

/**
 * 竞速加载 - 返回第一个成功的结果
 *
 * 用途:
 * - 从多个备用数据源获取数据
 * - 使用最快的响应
 *
 * 使用方法:
 * ```typescript
 * const config = await raceQueries([
 *   () => getCachedConfig(),
 *   () => getRemoteConfig(),
 * ])
 * ```
 */
export async function raceQueries<T = any>(
  queryFns: Array<() => Promise<T>>,
): Promise<T | null> {
  try {
    return await Promise.race(queryFns)
  } catch (error) {
    console.error('[Race] All queries failed:', error)
    return null
  }
}

/**
 * 优先级加载 - 按优先级顺序加载，可中断
 *
 * 用途:
 * - 关键数据优先加载
 * - 后续数据可选
 * - 可随时中断
 */
export async function priorityLoadQueries<T = any>(
  queryFns: Array<() => Promise<T>>,
  onProgress?: (current: number, total: number) => void,
): Promise<(T | null)[]> {
  const results: (T | null)[] = []

  for (let i = 0; i < queryFns.length; i++) {
    try {
      const result = await queryFns[i]()
      results.push(result)
    } catch (error) {
      console.error(`[Priority] Query ${i} failed:`, error)
      results.push(null)
    }

    onProgress?.(i + 1, queryFns.length)
  }

  return results
}
