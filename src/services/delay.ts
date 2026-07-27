import {
  delayProxyByName,
  healthcheckNodeInProvider,
  type ProxyDelay,
} from 'tauri-plugin-mihomo-api'

import {
  memberDetails,
  providerNameOf,
  type InteractableProxyMember,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'
import { classifyDelay, DEFAULT_DELAY_TIMEOUT } from '@/utils/delay'

/** A group's delays, handed to sorting as a value it can depend on. */
export type DelaySnapshot = {
  of: (member: ResolvedProxyMember) => number
}

const hashKey = (name: string, group: string) => `${group ?? ''}::${name}`

export interface DelayUpdate {
  delay: number
  elapsed?: number
  updatedAt: number
}

const CACHE_TTL = 30 * 60 * 1000

class DelayManager {
  private cache = new Map<string, DelayUpdate>()
  private urlMap = new Map<string, string>()

  // 每个节点的监听
  private listenerMap = new Map<string, (update: DelayUpdate) => void>()

  // 每个分组的监听
  private groupListenerMap = new Map<string, Set<() => void>>()
  /// A stable handle per group, replaced when that group settles. Consumers compare its
  /// identity, so it must not be rebuilt on every read.
  private groupSnapshots = new Map<string, DelaySnapshot>()
  /// Keyed by the joined group names a consumer asked for; cleared whenever any group
  /// settles, so the map identity changes while unaffected groups keep theirs.
  private groupSetSnapshots = new Map<
    string,
    ReadonlyMap<string, DelaySnapshot>
  >()
  /// Batches in flight per group. A single test that lands inside one must not announce:
  /// sorting from a half-measured group is the reordering this design exists to avoid.
  private activeBatches = new Map<string, number>()

  private pendingItemUpdates = new Map<string, DelayUpdate[]>()
  private pendingGroupUpdates = new Set<string>()
  private itemFlushScheduled = false
  private groupFlushScheduled = false

  private scheduleOnNextFrame(run: () => void): void {
    if (typeof window !== 'undefined') {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
        return
      }
      if (typeof window.setTimeout === 'function') {
        window.setTimeout(run, 0)
        return
      }
    }

    Promise.resolve().then(run)
  }

  private scheduleItemFlush() {
    if (this.itemFlushScheduled) return
    this.itemFlushScheduled = true

    this.scheduleOnNextFrame(() => {
      this.itemFlushScheduled = false
      const updates = this.pendingItemUpdates
      this.pendingItemUpdates = new Map()

      updates.forEach((queue, key) => {
        const listener = this.listenerMap.get(key)
        if (!listener) return

        queue.forEach((update) => {
          try {
            listener(update)
          } catch (error) {
            console.error(
              `[DelayManager] 通知节点延迟监听器失败: ${key}`,
              error,
            )
          }
        })
      })
    })
  }

  private scheduleGroupFlush() {
    if (this.groupFlushScheduled) return
    this.groupFlushScheduled = true

    this.scheduleOnNextFrame(() => {
      this.groupFlushScheduled = false
      const groups = this.pendingGroupUpdates
      this.pendingGroupUpdates = new Set()

      groups.forEach((group) => {
        const listeners = this.groupListenerMap.get(group)
        if (!listeners) return
        // Copied before iterating: a listener is free to unsubscribe as it runs.
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error(
              `[DelayManager] 通知分组延迟监听器失败: ${group}`,
              error,
            )
          }
        }
      })
    })
  }

  private queueGroupNotification(group: string) {
    if ((this.activeBatches.get(group) ?? 0) > 0) return
    // Dropped so the next read builds a fresh identity. Only this group's snapshot changes;
    // the set-level map is rebuilt too, but its other entries keep their identities.
    this.groupSnapshots.delete(group)
    this.groupSetSnapshots.clear()
    this.pendingGroupUpdates.add(group)
    this.scheduleGroupFlush()
  }

  /**
   * A handle to this group's delays whose identity changes only when a test settles.
   *
   * Read during render and compared by identity, so it is cached rather than rebuilt: a
   * fresh object per read would make every consumer recompute on every render.
   */
  /**
   * The delays for a set of groups, keyed by group name.
   *
   * Cached so its identity is stable between settles, while each group's own snapshot keeps
   * its identity unless *that* group settled — which is what lets a per-group cache survive
   * a test in a neighbouring group.
   */
  groupsDelays(groupKey: string): ReadonlyMap<string, DelaySnapshot> {
    const cached = this.groupSetSnapshots.get(groupKey)
    if (cached) return cached

    const names = groupKey ? groupKey.split(' ') : []
    const snapshots = new Map(
      names.map((name) => [name, this.groupDelays(name)]),
    )
    this.groupSetSnapshots.set(groupKey, snapshots)
    return snapshots
  }

  groupDelays(group: string): DelaySnapshot {
    const existing = this.groupSnapshots.get(group)
    if (existing) return existing

    const snapshot: DelaySnapshot = {
      of: (member) => this.getDelayFix(member, group),
    }
    this.groupSnapshots.set(group, snapshot)
    return snapshot
  }

  setUrl(group: string, url: string) {
    debugLog(`[DelayManager] 设置测试URL，组: ${group}, URL: ${url}`)
    this.urlMap.set(group, url)
  }

  getUrl(group: string) {
    const url = this.urlMap.get(group)
    debugLog(
      `[DelayManager] 获取测试URL，组: ${group}, URL: ${url || '未设置'}`,
    )
    // 如果未设置URL，返回默认URL
    return url || 'http://cp.cloudflare.com/generate_204'
  }

  setListener(
    name: string,
    group: string,
    listener: (update: DelayUpdate) => void,
  ) {
    const key = hashKey(name, group)
    this.listenerMap.set(key, listener)
  }

  removeListener(name: string, group: string) {
    const key = hashKey(name, group)
    this.listenerMap.delete(key)
  }

  /**
   * Called when a delay test for `group` has settled: once per single test, and once for a
   * whole batch however many proxies it covered.
   *
   * "Settled" rather than "changed" on purpose. Per-proxy display updates are already live
   * through `setListener`; this exists for the things that must not move while results are
   * still arriving, chiefly sort order.
   */
  /// Returns its own unsubscribe, so two views may watch the same group without one
  /// silently replacing the other's listener.
  addGroupListener(group: string, listener: () => void): () => void {
    const listeners = this.groupListenerMap.get(group) ?? new Set()
    listeners.add(listener)
    this.groupListenerMap.set(group, listeners)

    return () => {
      const current = this.groupListenerMap.get(group)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.groupListenerMap.delete(group)
    }
  }

  setDelay(
    name: string,
    group: string,
    delay: number,
    meta?: { elapsed?: number },
  ): DelayUpdate {
    const key = hashKey(name, group)
    debugLog(
      `[DelayManager] 设置延迟，代理: ${name}, 组: ${group}, 延迟: ${delay}`,
    )
    const update: DelayUpdate = {
      delay,
      elapsed: meta?.elapsed,
      updatedAt: Date.now(),
    }

    this.cache.set(key, update)

    const queue = this.pendingItemUpdates.get(key)
    if (queue) {
      queue.push(update)
    } else {
      this.pendingItemUpdates.set(key, [update])
    }
    this.scheduleItemFlush()

    return update
  }

  getDelayUpdate(name: string, group: string) {
    const key = hashKey(name, group)
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.updatedAt > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }

    return { ...entry }
  }

  getDelay(name: string, group: string) {
    const update = this.getDelayUpdate(name, group)
    return update ? update.delay : -1
  }

  getDelayFix(member: ResolvedProxyMember, group: string) {
    if (member.kind === 'unresolved') return -1
    const details = memberDetails(member)
    const name = member.ref.name
    const update = this.getDelayUpdate(name, group)
    if (update && (update.delay >= 0 || update.delay === -2)) {
      return update.delay
    }

    if (details?.history && details.history.length > 0) {
      // 0ms以error显示
      return details.history[details.history.length - 1].delay || 1e6
    }
    return -1
  }

  // 统一延迟测试检测
  async unifiedDelayCheck(
    name: string,
    url: string,
    timeout: number,
    providerName?: string,
  ) {
    if (providerName)
      return healthcheckNodeInProvider(providerName, name, url, timeout)
    return delayProxyByName(name, url, timeout)
  }

  /**
   * Test one proxy, then tell the group its ordering may have changed.
   *
   * The announcement is the point at which a sorted list is allowed to re-sort. It is
   * deliberately *not* made per result inside a batch — see `checkListDelay`.
   */
  async checkDelay(
    member: InteractableProxyMember,
    group: string,
    timeout: number,
  ): Promise<DelayUpdate> {
    const update = await this.measureDelay(member, group, timeout)
    this.queueGroupNotification(group)
    return update
  }

  private async measureDelay(
    member: InteractableProxyMember,
    group: string,
    timeout: number,
  ): Promise<DelayUpdate> {
    const name = member.ref.name
    const providerName =
      member.kind === 'node' ? providerNameOf(member.node) : undefined
    const apiName =
      member.kind === 'node' && member.node.source.kind === 'provider'
        ? member.node.source.proxyName
        : name
    debugLog(
      `[DelayManager] 开始测试延迟，代理: ${name}, 组: ${group}, 超时: ${timeout}ms`,
    )

    // 先将状态设置为测试中
    this.setDelay(name, group, -2)

    const startTime = Date.now()

    try {
      const url = this.getUrl(group)
      debugLog(`[DelayManager] 调用API测试延迟，代理: ${name}, URL: ${url}`)

      // 设置超时处理, delay = 0 为超时
      const timeoutPromise = new Promise<ProxyDelay>((resolve) => {
        setTimeout(() => resolve({ delay: 0 }), timeout)
      })

      // 使用Promise.race来实现超时控制
      const result = await Promise.race([
        this.unifiedDelayCheck(apiName, url, timeout, providerName),
        timeoutPromise,
      ])

      // 确保至少显示500ms的加载动画
      const elapsedTime = Date.now() - startTime
      if (elapsedTime < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsedTime))
      }

      const delay = result.delay
      const elapsed = elapsedTime
      debugLog(`[DelayManager] 延迟测试完成，代理: ${name}, 结果: ${delay}ms`)

      return this.setDelay(name, group, delay, { elapsed })
    } catch (error) {
      // 确保至少显示500ms的加载动画
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.error(`[DelayManager] 延迟测试出错，代理: ${name}`, error)
      const delay = 1e6 // error
      const elapsed = Date.now() - startTime

      return this.setDelay(name, group, delay, { elapsed })
    }
  }

  async checkListDelay(
    proxies: InteractableProxyMember[],
    group: string,
    timeout: number,
    concurrency = 36,
  ) {
    debugLog(
      `[DelayManager] 批量测试延迟开始，组: ${group}, 数量: ${proxies.length}, 并发数: ${concurrency}`,
    )
    const names = proxies.map((member) => member.ref.name)
    this.activeBatches.set(group, (this.activeBatches.get(group) ?? 0) + 1)
    // 设置正在延迟测试中
    names.forEach((name) => {
      this.setDelay(name, group, -2)
    })

    let index = 0
    const startTime = Date.now()

    const help = async (): Promise<void> => {
      const currMember = proxies[index++]
      if (!currMember) return
      const currName = currMember.ref.name

      try {
        // 确保API调用前状态为测试中
        this.setDelay(currName, group, -2)

        // 添加一些随机延迟，避免所有请求同时发出和返回
        if (index > 1) {
          // 第一个不延迟，保持响应性
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 200),
          )
        }

        // Measured without announcing: a sorted list that re-ordered on every result would
        // reshuffle continuously for the length of the test, with rows moving out from under
        // the pointer. The group is told once, below, when the batch has settled.
        await this.measureDelay(currMember, group, timeout)
      } catch (error) {
        console.error(
          `[DelayManager] 批量测试单个代理出错，代理: ${currName}`,
          error,
        )
        // 设置为错误状态
        this.setDelay(currName, group, 1e6)
      }

      return help()
    }

    // 限制并发数，避免发送太多请求
    const actualConcurrency = Math.min(concurrency, names.length, 10)
    debugLog(`[DelayManager] 实际并发数: ${actualConcurrency}`)

    const promiseList: Promise<void>[] = []
    for (let i = 0; i < actualConcurrency; i++) {
      promiseList.push(help())
    }

    try {
      await Promise.all(promiseList)
    } finally {
      // In a `finally` so a throw cannot leave the group unannounced: the proxies would sit
      // at -2 and the order would stay stale with nothing later to repair it.
      const remaining = (this.activeBatches.get(group) ?? 1) - 1
      if (remaining > 0) {
        this.activeBatches.set(group, remaining)
      } else {
        this.activeBatches.delete(group)
        this.queueGroupNotification(group)
      }
    }
    const totalTime = Date.now() - startTime
    debugLog(
      `[DelayManager] 批量测试延迟完成，组: ${group}, 总耗时: ${totalTime}ms`,
    )
  }

  formatDelay(delay: number, timeout = DEFAULT_DELAY_TIMEOUT) {
    switch (classifyDelay(delay, timeout)) {
      case 'untested':
        return '-'
      case 'testing':
        return 'testing'
      case 'timeout':
        return 'Timeout'
      case 'error':
        return 'Error'
      case 'measured':
        return `${delay}`
    }
  }

  formatDelayColor(delay: number, timeout = DEFAULT_DELAY_TIMEOUT) {
    switch (classifyDelay(delay, timeout)) {
      case 'untested':
      case 'testing':
        return ''
      case 'timeout':
      case 'error':
        return 'error.main'
      case 'measured':
        // How a measurement is graded is this widget's own decision; the thresholds differ
        // from the signal icon's on purpose, because a colour has fewer steps than four bars.
        if (delay >= 400) return 'warning.main'
        if (delay >= 250) return 'primary.main'
        return 'success.main'
    }
  }
}

export default new DelayManager()
