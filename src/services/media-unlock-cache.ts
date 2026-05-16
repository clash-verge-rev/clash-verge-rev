/**
 * 媒体解锁检查缓存系统
 *
 * 目的:
 * - 缓存媒体解锁检查结果，避免重复检查
 * - 设置适当的 TTL（默认 5 分钟）
 * - 提供手动刷新机制
 */

export interface UnlockCheckResult {
  item: any
  timestamp: number
  ttl: number
}

export interface UnlockCheckCache {
  results: Map<string, UnlockCheckResult>
  stats: {
    totalChecks: number
    cacheHits: number
    cacheMisses: number
    lastCheckTime: number
  }
}

class MediaUnlockCheckCache {
  private cache = new Map<string, UnlockCheckResult>()
  private stats = {
    totalChecks: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastCheckTime: 0,
  }

  // 默认 TTL: 5 分钟
  private defaultTtl = 5 * 60 * 1000

  /**
   * 获取缓存的检查结果
   */
  get(key: string): any | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.cacheMisses++
      return undefined
    }

    // 检查是否已过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      this.stats.cacheMisses++
      return undefined
    }

    this.stats.cacheHits++
    return entry.item
  }

  /**
   * 设置缓存结果
   */
  set(key: string, result: any, ttl: number = this.defaultTtl): void {
    this.cache.set(key, {
      item: result,
      timestamp: Date.now(),
      ttl,
    })
    this.stats.totalChecks++
    this.stats.lastCheckTime = Date.now()
    console.debug(`[MediaUnlockCache] Cached: ${key} (TTL: ${ttl}ms)`)
  }

  /**
   * 批量设置结果
   */
  setMultiple(
    results: Array<{ key: string; result: any }>,
    ttl?: number,
  ): void {
    results.forEach(({ key, result }) => {
      this.set(key, result, ttl)
    })
  }

  /**
   * 清除特定项
   */
  invalidate(key: string): boolean {
    const existed = this.cache.has(key)
    if (existed) {
      this.cache.delete(key)
      console.debug(`[MediaUnlockCache] Invalidated: ${key}`)
    }
    return existed
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    console.debug(`[MediaUnlockCache] Cleared ${size} entries`)
  }

  /**
   * 获取所有缓存的检查结果
   */
  getAll(): any[] {
    const now = Date.now()
    const results: any[] = []

    // 清理过期项并收集有效项
    const keysToDelete: string[] = []

    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key)
      } else {
        results.push(entry.item)
      }
    })

    // 删除过期项
    keysToDelete.forEach((key) => this.cache.delete(key))

    return results
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const hitRate =
      this.stats.totalChecks > 0
        ? ((this.stats.cacheHits / this.stats.totalChecks) * 100).toFixed(2)
        : '0.00'

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
    }
  }

  /**
   * 打印统计信息
   */
  printStats(): void {
    const stats = this.getStats()
    console.group('📊 Media Unlock Check Cache Statistics')
    console.log(`Total Checks: ${stats.totalChecks}`)
    console.log(`Cache Hits: ${stats.cacheHits}`)
    console.log(`Cache Misses: ${stats.cacheMisses}`)
    console.log(`Hit Rate: ${stats.hitRate}`)
    console.log(`Cached Entries: ${stats.cacheSize}`)
    console.log(
      `Last Check: ${new Date(stats.lastCheckTime).toLocaleTimeString()}`,
    )
    console.groupEnd()
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastCheckTime: 0,
    }
  }
}

// 全局实例
export const mediaUnlockCheckCache = new MediaUnlockCheckCache()

/**
 * 缓存键生成器
 */
export const createUnlockCheckKey = (itemName: string): string => {
  return `unlock_check_${itemName}`.toLowerCase()
}

/**
 * Hook: 使用缓存的检查结果
 */
import React from 'react'

export function useCachedUnlockCheck(
  itemName: string,
  onCacheMiss?: () => void,
) {
  return React.useMemo(() => {
    const key = createUnlockCheckKey(itemName)
    const cached = mediaUnlockCheckCache.get(key)

    if (!cached) {
      onCacheMiss?.()
    }

    return { key, cached }
  }, [itemName, onCacheMiss])
}

/**
 * 获取所有有效的缓存结果
 */
export function getCachedUnlockResults(): any[] {
  return mediaUnlockCheckCache.getAll()
}
