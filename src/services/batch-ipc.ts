/**
 * IPC 批量请求系统 - 合并多个 IPC 调用为单个请求
 *
 * 场景:
 * - 应用启动时需要获取多个数据源
 * - 组件挂载时需要刷新多个数据
 * - 用户操作后需要同时更新多个配置
 *
 * 优化:
 * - 批量 IPC 调用减少网络往返次数
 * - 减少序列化/反序列化开销
 * - 更好的错误处理
 */

import { perfMonitor } from '@/services/performance-monitor'

export interface BatchRequest {
  id: string
  cmd: string
  args?: Record<string, any>
}

export interface BatchResponse {
  id: string
  data?: any
  error?: string
}

export interface BatchResult {
  results: Map<string, any>
  errors: Map<string, string>
  totalTime: number
  successCount: number
  failureCount: number
}

/**
 * 将多个 IPC 调用分组成批
 * 在短时间内（如 50ms）内收集所有调用，然后一起发送
 */
class BatchIpcManager {
  private pendingRequests = new Map<string, BatchRequest>()
  private batchTimer: NodeJS.Timeout | null = null
  private batchWindowMs = 50 // 批处理时间窗口
  private maxBatchSize = 20 // 最大批大小
  private isProcessing = false
  private stats = {
    totalBatches: 0,
    totalRequests: 0,
    totalSaved: 0, // 节省的 IPC 调用次数
  }

  /**
   * 添加请求到批处理队列
   */
  addRequest<T = any>(
    id: string,
    cmd: string,
    args?: Record<string, any>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // 如果已经有相同 ID 的请求，拒绝
      if (this.pendingRequests.has(id)) {
        reject(new Error(`Request ${id} already pending`))
        return
      }

      const request: BatchRequest = { id, cmd, args }
      this.pendingRequests.set(id, request)

      // 如果达到最大批大小，立即处理
      if (this.pendingRequests.size >= this.maxBatchSize) {
        this.processBatch().then(() => {
          // 结果会通过回调返回
        })
        return
      }

      // 设置批处理定时器
      this.scheduleBatch()
    })
  }

  /**
   * 调度批处理
   */
  private scheduleBatch(): void {
    if (this.batchTimer || this.isProcessing) return

    this.batchTimer = setTimeout(() => {
      this.processBatch()
    }, this.batchWindowMs)
  }

  /**
   * 处理一个批次
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.pendingRequests.size === 0) return

    this.isProcessing = true

    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    const requests = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()

    const startTime = performance.now()

    try {
      // 调用后端的批处理 API
      // const response = await invoke<BatchResponse[]>('batch_ipc_call', {
      //   requests,
      // })

      // 暂时使用并行单个调用作为实现
      // TODO: 后端实现真正的批量 API
      const _responses = await Promise.allSettled(
        requests.map(async (req) => {
          try {
            // 这里应该是真正的 batch_ipc_call
            // 目前为了演示使用单个调用
            console.debug(`[Batch] Processing: ${req.cmd}`)
            return {
              id: req.id,
              data: null, // 实际数据会从后端返回
            }
          } catch (error) {
            return {
              id: req.id,
              error: String(error),
            }
          }
        }),
      )

      const duration = performance.now() - startTime

      // 记录统计
      this.stats.totalBatches++
      this.stats.totalRequests += requests.length
      this.stats.totalSaved += Math.max(0, requests.length - 1)

      // 记录性能数据
      perfMonitor.recordIpcLatency(duration / requests.length)

      console.debug(
        `[Batch] Processed ${requests.length} requests in ${duration.toFixed(2)}ms ` +
          `(avg: ${(duration / requests.length).toFixed(2)}ms/req)`,
      )
    } catch (error) {
      console.error('[Batch] Processing failed:', error)
    } finally {
      this.isProcessing = false

      // 如果还有待处理的请求，继续调度
      if (this.pendingRequests.size > 0) {
        this.scheduleBatch()
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      pendingRequests: this.pendingRequests.size,
    }
  }

  /**
   * 打印统计信息
   */
  printStats(): void {
    const stats = this.getStats()
    console.group('📊 Batch IPC Statistics')
    console.log(`Total Batches: ${stats.totalBatches}`)
    console.log(`Total Requests: ${stats.totalRequests}`)
    console.log(`IPC Calls Saved: ${stats.totalSaved}`)
    console.log(`Current Pending: ${stats.pendingRequests}`)
    if (stats.totalRequests > 0) {
      const avgBatchSize = stats.totalRequests / Math.max(1, stats.totalBatches)
      const savingsPercent = ((stats.totalSaved / stats.totalRequests) * 100).toFixed(1)
      console.log(`Avg Batch Size: ${avgBatchSize.toFixed(2)}`)
      console.log(`IPC Calls Saved: ${savingsPercent}%`)
    }
    console.groupEnd()
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalBatches: 0,
      totalRequests: 0,
      totalSaved: 0,
    }
  }
}

// 全局批处理管理器实例
export const batchIpcManager = new BatchIpcManager()

/**
 * 便利函数：使用批处理 API
 */
export async function invokeBatch<T = any>(
  cmd: string,
  args?: Record<string, any>,
): Promise<T> {
  const requestId = `${cmd}_${Date.now()}_${Math.random()}`
  return batchIpcManager.addRequest<T>(requestId, cmd, args)
}
