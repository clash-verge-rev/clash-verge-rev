import { delayProxyByName, ProxyDelay } from 'tauri-plugin-mihomo-api'

import {
  appendTestLog,
  getTestErrorMessage,
  sanitizeTestMessage,
  showTestErrorSummary,
} from '@/services/test-log'
import { debugLog } from '@/utils/debug'

const hashKey = (name: string, group: string) => `${group ?? ''}::${name}`

export interface DelayUpdate {
  delay: number
  elapsed?: number
  error?: string
  updatedAt: number
}

const CACHE_TTL = 30 * 60 * 1000
const MAX_LATENCY_SAMPLES = 20

class DelayManager {
  private cache = new Map<string, DelayUpdate>()
  private urlMap = new Map<string, string>()
  private latencySamples = new Map<string, number[]>()
  private activeTests = new Map<string, { name: string; group: string }>()
  private heldResultKeys = new Set<string>()
  private heldResults = new Map<string, DelayUpdate>()
  private cancelGeneration = 0

  // 每个节点的监听
  private listenerMap = new Map<string, (update: DelayUpdate) => void>()

  // 每个分组的监听
  private groupListenerMap = new Map<string, () => void>()

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
        const listener = this.groupListenerMap.get(group)
        if (!listener) return
        try {
          listener()
        } catch (error) {
          console.error(
            `[DelayManager] 通知分组延迟监听器失败: ${group}`,
            error,
          )
        }
      })
    })
  }

  private queueGroupNotification(group: string) {
    this.pendingGroupUpdates.add(group)
    this.scheduleGroupFlush()
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

  setGroupListener(group: string, listener: () => void) {
    this.groupListenerMap.set(group, listener)
  }

  removeGroupListener(group: string) {
    this.groupListenerMap.delete(group)
  }

  cancelAll() {
    this.cancelGeneration += 1
    const active = [...this.activeTests.values()]
    this.activeTests.clear()
    active.forEach(({ name, group }) => this.setDelay(name, group, -1))
  }

  holdResult(name: string, group: string) {
    this.heldResultKeys.add(hashKey(name, group))
  }

  releaseHeldResult(name: string, group: string) {
    const key = hashKey(name, group)
    this.heldResultKeys.delete(key)
    const update = this.heldResults.get(key)
    if (!update) return
    this.heldResults.delete(key)
    this.publishDelayUpdate(key, group, update)
  }

  setDelay(
    name: string,
    group: string,
    delay: number,
    meta?: { elapsed?: number; error?: string },
  ): DelayUpdate {
    const key = hashKey(name, group)
    debugLog(
      `[DelayManager] 设置延迟，代理: ${name}, 组: ${group}, 延迟: ${delay}`,
    )
    const update: DelayUpdate = {
      delay,
      elapsed: meta?.elapsed,
      error: meta?.error,
      updatedAt: Date.now(),
    }

    if (delay === -2) {
      this.activeTests.set(key, { name, group })
    } else {
      this.activeTests.delete(key)
    }
    if (delay > 0 && delay < 1e5) {
      this.recordLatencySample(key, delay)
    }

    if (this.heldResultKeys.has(key) && delay !== -2) {
      this.heldResults.set(key, update)
      return update
    }

    this.publishDelayUpdate(key, group, update)
    return update
  }

  private publishDelayUpdate(key: string, group: string, update: DelayUpdate) {
    this.cache.set(key, update)

    const queue = this.pendingItemUpdates.get(key)
    if (queue) {
      queue.push(update)
    } else {
      this.pendingItemUpdates.set(key, [update])
    }
    this.scheduleItemFlush()
    this.queueGroupNotification(group)
  }

  private recordLatencySample(key: string, delay: number) {
    const samples = this.latencySamples.get(key) ?? []
    samples.push(delay)
    this.latencySamples.set(key, samples.slice(-MAX_LATENCY_SAMPLES))
  }

  getJitter(name: string, group: string) {
    const samples = this.latencySamples.get(hashKey(name, group)) ?? []
    if (samples.length < 2) return 0

    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const variance =
      samples.reduce((sum, value) => {
        const diff = value - mean
        return sum + diff * diff
      }, 0) / samples.length

    return Math.sqrt(variance)
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
    const key = hashKey(name, group)
    const held = this.heldResults.get(key)
    if (held) return held.delay

    const update = this.getDelayUpdate(name, group)
    return update ? update.delay : -1
  }

  /// 暂时修复provider的节点延迟排序的问题
  getDelayFix(proxy: IProxyItem, group: string) {
    if (!proxy.provider) {
      const update = this.getDelayUpdate(proxy.name, group)
      if (update && (update.delay >= 0 || update.delay === -2)) {
        return update.delay
      }
    }

    // 添加 history 属性的安全检查
    if (proxy.history && proxy.history.length > 0) {
      // 0ms以error显示
      return proxy.history[proxy.history.length - 1].delay || 1e6
    }
    return -1
  }

  async checkDelay(
    name: string,
    group: string,
    timeout: number,
    generation = this.cancelGeneration,
  ): Promise<DelayUpdate> {
    debugLog(
      `[DelayManager] 开始测试延迟，代理: ${name}, 组: ${group}, 超时: ${timeout}ms`,
    )

    // 先将状态设置为测试中
    this.setDelay(name, group, -2)

    const startTime = Date.now()

    try {
      if (this.isCancelled(generation)) {
        appendTestLog({ kind: 'delay', status: 'cancelled', group, name })
        return this.setDelay(name, group, -1)
      }

      const url = this.getUrl(group)
      debugLog(`[DelayManager] 调用API测试延迟，代理: ${name}, URL: ${url}`)

      // 设置超时处理, delay = 0 为超时
      const timeoutPromise = new Promise<ProxyDelay>((resolve) => {
        setTimeout(() => resolve({ delay: 0 }), timeout)
      })

      // 使用Promise.race来实现超时控制
      const result = await Promise.race([
        delayProxyByName(name, url, timeout),
        timeoutPromise,
      ])

      if (this.isCancelled(generation)) {
        appendTestLog({ kind: 'delay', status: 'cancelled', group, name })
        return this.setDelay(name, group, -1)
      }

      // 确保至少显示500ms的加载动画
      const elapsedTime = Date.now() - startTime
      if (elapsedTime < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsedTime))
      }

      const delay = result.delay
      const elapsed = elapsedTime
      debugLog(`[DelayManager] 延迟测试完成，代理: ${name}, 结果: ${delay}ms`)

      const error =
        delay === 0 || delay >= timeout
          ? `Delay test timed out after ${timeout}ms`
          : undefined
      appendTestLog({
        kind: 'delay',
        status: error ? 'timeout' : 'success',
        group,
        name,
        delay,
        elapsed,
        message: error,
      })

      return this.setDelay(name, group, delay, { elapsed, error })
    } catch (error) {
      // 确保至少显示500ms的加载动画
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.error(`[DelayManager] 延迟测试出错，代理: ${name}`, error)
      const delay = 1e6 // error
      const elapsed = Date.now() - startTime
      const message = getTestErrorMessage(error)
      appendTestLog({
        kind: 'delay',
        status: 'error',
        group,
        name,
        delay,
        elapsed,
        message,
      })

      return this.setDelay(name, group, delay, {
        elapsed,
        error: sanitizeTestMessage(message),
      })
    }
  }

  async checkListDelay(
    nameList: string[],
    group: string,
    timeout: number,
    concurrency = 36,
  ) {
    debugLog(
      `[DelayManager] 批量测试延迟开始，组: ${group}, 数量: ${nameList.length}, 并发数: ${concurrency}`,
    )
    const names = nameList.filter(Boolean)
    const generation = this.cancelGeneration
    // 设置正在延迟测试中
    names.forEach((name) => this.setDelay(name, group, -2))

    let index = 0
    const startTime = Date.now()
    const listener = this.groupListenerMap.get(group)
    let failed = 0

    const help = async (): Promise<void> => {
      if (this.isCancelled(generation)) return
      const currName = names[index++]
      if (!currName) return

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

        const update = await this.checkDelay(currName, group, timeout, generation)
        if (update.delay === 0 || update.delay >= timeout) {
          failed += 1
        }
        if (listener) {
          this.queueGroupNotification(group)
        }
      } catch (error) {
        console.error(
          `[DelayManager] 批量测试单个代理出错，代理: ${currName}`,
          error,
        )
        // 设置为错误状态
        failed += 1
        this.setDelay(currName, group, 1e6, {
          error: sanitizeTestMessage(getTestErrorMessage(error)),
        })
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

    await Promise.all(promiseList)
    if (!this.isCancelled(generation)) {
      showTestErrorSummary({
        kind: 'delay',
        total: names.length,
        failed,
      })
    }
    const totalTime = Date.now() - startTime
    debugLog(
      `[DelayManager] 批量测试延迟完成，组: ${group}, 总耗时: ${totalTime}ms`,
    )
  }

  private isCancelled(generation: number) {
    return generation !== this.cancelGeneration
  }

  formatDelay(delay: number, timeout = 10000) {
    if (delay === -1) return '-'
    if (delay === -2) return 'testing'
    if (delay === 0 || (delay >= timeout && delay <= 1e5)) return 'Timeout'
    if (delay > 1e5) return 'Error'
    return `${Math.round(delay)} ms`
  }

  formatDelayColor(delay: number, timeout = 10000) {
    if (delay < 0) return ''
    if (delay === 0 || delay >= timeout) return 'error.main'
    if (delay >= 10000) return 'error.main'
    if (delay >= 400) return 'warning.main'
    if (delay >= 250) return 'primary.main'
    return 'success.main'
  }
}

export default new DelayManager()
