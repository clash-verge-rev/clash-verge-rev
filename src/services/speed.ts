// SpeedManager – 追踪各代理节点下载速度（MB/s）的单例
// 使用与 DelayManager 相同的批量/监听器模式
//
// 哨兵值：
//   -1  = 无数据（不显示）
//   -2  = 测速中（显示加载动画）
//    0  = 测速失败 / 出错
//   >0  = MB/s

import { cmdTestDownloadSpeed } from '@/services/cmds'
import { selectNodeForGroup } from 'tauri-plugin-mihomo-api'

const hashKey = (name: string, group: string) => `${group ?? ''}::${name}`

export interface SpeedUpdate {
  /** MB/s，或哨兵值 -1 / -2 / 0 */
  speed: number
  updatedAt: number
}

const CACHE_TTL = 30 * 60 * 1000 // 30分钟

class SpeedManager {
  private cache = new Map<string, SpeedUpdate>()
  private listenerMap = new Map<string, (update: SpeedUpdate) => void>()
  private groupListenerMap = new Map<string, () => void>()

  private pendingItemUpdates = new Map<string, SpeedUpdate[]>()
  private pendingGroupUpdates = new Set<string>()
  private itemFlushScheduled = false
  private groupFlushScheduled = false

  // ── 内部调度（与 DelayManager 相同的模式）──────────────────────────

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
        queue.forEach((u) => {
          try {
            listener(u)
          } catch {
            /* swallow */
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
        try {
          this.groupListenerMap.get(group)?.()
        } catch {
          /* swallow */
        }
      })
    })
  }

  private queueGroupNotification(group: string) {
    this.pendingGroupUpdates.add(group)
    this.scheduleGroupFlush()
  }

  // ── 公开 API ─────────────────────────────────────────────────────────────

  setListener(name: string, group: string, listener: (u: SpeedUpdate) => void) {
    this.listenerMap.set(hashKey(name, group), listener)
  }

  removeListener(name: string, group: string) {
    this.listenerMap.delete(hashKey(name, group))
  }

  setGroupListener(group: string, listener: () => void) {
    this.groupListenerMap.set(group, listener)
  }

  removeGroupListener(group: string) {
    this.groupListenerMap.delete(group)
  }

  setSpeed(name: string, group: string, speed: number): SpeedUpdate {
    const key = hashKey(name, group)
    const update: SpeedUpdate = { speed, updatedAt: Date.now() }
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

  getSpeedUpdate(name: string, group: string): SpeedUpdate | undefined {
    const key = hashKey(name, group)
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.updatedAt > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }
    return { ...entry }
  }

  getSpeed(name: string, group: string): number {
    return this.getSpeedUpdate(name, group)?.speed ?? -1
  }

  /**
   * 将速度值转换为显示用字符串。
   * -1  → ''（无数据，不显示）
   * -2  → 'testing'（由组件显示加载动画）
   *  0  → 'Err'
   * >0  → '12.3 MB/s'
   */
  formatSpeed(speed: number): string {
    if (speed === -1) return ''
    if (speed === -2) return 'testing'
    if (speed === 0) return 'Err'
    return `${speed.toFixed(1)} MB/s`
  }

  /** 根据速度值返回对应的 MUI 颜色。 */
  formatSpeedColor(speed: number): string {
    if (speed <= 0) return '' // -1, -2, 0 → 无颜色
    if (speed < 1) return 'error.main'
    if (speed < 5) return 'warning.main'
    return 'success.main' // ≥ 5 MB/s → 绿色
  }

  /**
   * 对绿色（ping < 250ms）代理列表依次进行下载速度测试。
   * 每个代理：临时切换 → 下载 → 记录速度 → 继续下一个。
   * 全部完成后恢复原来选中的代理。
   *
   * @param entries      待测试的 { name } 列表
   * @param group        代理组信息（name, now）
   * @param downloadUrl  下载测试 URL
   * @param timeoutMs    每个代理的超时时间（ms）
   * @param onProgress   每个代理完成后调用的回调（用于刷新 UI）
   */
  async checkListSpeed(
    entries: Array<{ name: string }>,
    group: { name: string; now?: string },
    downloadUrl: string,
    timeoutMs: number,
    onProgress?: () => void,
  ): Promise<void> {
    // 将所有目标标记为测速中（-2）
    for (const { name } of entries) {
      this.setSpeed(name, group.name, -2)
    }

    const originalProxy = group.now ?? null

    for (const { name } of entries) {
      try {
        // 切换到该代理
        await selectNodeForGroup(group.name, name)
        // 等待 mihomo 通过新节点路由流量
        await new Promise((r) => setTimeout(r, 300))

        const mbps = await cmdTestDownloadSpeed(downloadUrl, timeoutMs)
        this.setSpeed(name, group.name, mbps > 0 ? mbps : 0)
      } catch {
        this.setSpeed(name, group.name, 0)
      }

      this.queueGroupNotification(group.name)
      onProgress?.()
    }

    // 恢复原来选中的代理（尽力而为）
    if (originalProxy) {
      try {
        await selectNodeForGroup(group.name, originalProxy)
      } catch {
        // 恢复失败时忽略
      }
    }
  }
}

export default new SpeedManager()
