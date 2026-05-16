/**
 * 性能监测系统 - 收集应用的关键性能指标
 */

export interface PerformanceMetrics {
  // 页面加载指标
  fcp?: number // First Contentful Paint
  lcp?: number // Largest Contentful Paint
  tti?: number // Time to Interactive
  fid?: number // First Input Delay
  cls?: number // Cumulative Layout Shift

  // 应用启动指标
  appStartTime?: number // 应用总启动时间
  preloadTime?: number // 预加载时间
  renderTime?: number // 首次渲染时间

  // 数据加载指标
  dataFetchTimes: Record<string, number> // 各数据源的加载时间

  // 组件渲染指标
  componentRenderTimes: Record<string, number> // 各组件的渲染时间

  // 内存指标
  memoryUsage?: number // 内存占用（MB）

  // 网络指标
  ipcLatencies: number[] // IPC 调用延迟
  websocketLatencies: number[] // WebSocket 延迟

  // 时间戳
  timestamp: number
}

interface PerformanceEntry {
  name: string
  duration: number
  timestamp: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    dataFetchTimes: {},
    componentRenderTimes: {},
    ipcLatencies: [],
    websocketLatencies: [],
    timestamp: Date.now(),
  }

  private entries: PerformanceEntry[] = []
  private appStartTime = 0

  constructor() {
    this.init()
  }

  private init() {
    // 记录应用启动时间
    if (performance.timing) {
      this.appStartTime = performance.now()
    }

    // 监听标准 Web Vitals
    this.observeWebVitals()

    // 监听长任务
    this.observeLongTasks()
  }

  private observeWebVitals() {
    try {
      // First Contentful Paint
      const paintEntries = performance.getEntriesByType('paint')
      paintEntries.forEach((entry) => {
        if (entry.name === 'first-contentful-paint') {
          this.metrics.fcp = entry.startTime
        }
      })

      // Largest Contentful Paint
      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const lastEntry = entries[entries.length - 1]
          this.metrics.lcp = lastEntry.startTime
        })

        try {
          observer.observe({ entryTypes: ['largest-contentful-paint'] })
        } catch {
          // LCP not supported
        }
      }
    } catch (ignoreError) {
      console.warn('WebVitals monitoring failed:', ignoreError)
    }
  }

  private observeLongTasks() {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              // 记录超过 50ms 的任务
              this.entries.push({
                name: entry.name,
                duration: entry.duration,
                timestamp: entry.startTime,
              })
            }
          }
        })

        observer.observe({ entryTypes: ['longtask'] })
      } catch (ignoreError) {
        // LongTask not supported
      }
    }
  }

  /**
   * 记录数据加载时间
   */
  recordDataFetchTime(source: string, duration: number) {
    this.metrics.dataFetchTimes[source] = duration
    console.debug(`[Perf] Data fetch "${source}": ${duration.toFixed(2)}ms`)
  }

  /**
   * 记录组件渲染时间
   */
  recordComponentRenderTime(componentName: string, duration: number) {
    this.metrics.componentRenderTimes[componentName] = duration
    if (duration > 16) {
      // 超过一帧时间（16ms）时警告
      console.warn(
        `[Perf] Component render "${componentName}" took ${duration.toFixed(2)}ms (exceeds 16ms frame time)`,
      )
    } else {
      console.debug(`[Perf] Component render "${componentName}": ${duration.toFixed(2)}ms`)
    }
  }

  /**
   * 记录 IPC 调用延迟
   */
  recordIpcLatency(latency: number) {
    this.metrics.ipcLatencies.push(latency)
    if (latency > 100) {
      console.warn(`[Perf] High IPC latency: ${latency.toFixed(2)}ms`)
    }
  }

  /**
   * 记录 WebSocket 延迟
   */
  recordWebSocketLatency(latency: number) {
    this.metrics.websocketLatencies.push(latency)
  }

  /**
   * 记录应用启动时间
   */
  recordAppStartTime(duration: number) {
    this.metrics.appStartTime = duration
    console.info(`[Perf] App started in ${duration.toFixed(2)}ms`)
  }

  /**
   * 记录预加载时间
   */
  recordPreloadTime(duration: number) {
    this.metrics.preloadTime = duration
    console.info(`[Perf] Preload completed in ${duration.toFixed(2)}ms`)
  }

  /**
   * 获取所有指标
   */
  getMetrics(): PerformanceMetrics {
    return {
      ...this.metrics,
      timestamp: Date.now(),
      memoryUsage: this.getMemoryUsage(),
    }
  }

  /**
   * 获取内存使用情况
   */
  private getMemoryUsage(): number | undefined {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      return Math.round(memory.usedJSHeapSize / 1024 / 1024) // 转换为 MB
    }
    return undefined
  }

  /**
   * 打印性能报告
   */
  printReport() {
    const metrics = this.getMetrics()
    const report = {
      '应用启动': {
        '总启动时间': `${metrics.appStartTime?.toFixed(2)}ms`,
        '预加载时间': `${metrics.preloadTime?.toFixed(2)}ms`,
      },
      'Web Vitals': {
        'FCP (First Contentful Paint)': `${metrics.fcp?.toFixed(2)}ms`,
        'LCP (Largest Contentful Paint)': `${metrics.lcp?.toFixed(2)}ms`,
      },
      '数据加载': this.formatMetricObject(metrics.dataFetchTimes),
      '组件渲染': this.formatMetricObject(metrics.componentRenderTimes),
      '网络': {
        'IPC 平均延迟': `${this.getAverageLatency(metrics.ipcLatencies).toFixed(2)}ms`,
        'IPC P95': `${this.getPercentile(metrics.ipcLatencies, 95).toFixed(2)}ms`,
        'WebSocket 平均延迟': `${this.getAverageLatency(metrics.websocketLatencies).toFixed(2)}ms`,
      },
      '内存': {
        '堆内存使用': `${metrics.memoryUsage}MB`,
      },
    }

    console.group('📊 性能指标报告')
    console.table(report)
    console.groupEnd()

    return report
  }

  private formatMetricObject(obj: Record<string, number>): Record<string, string> {
    const formatted: Record<string, string> = {}
    for (const [key, value] of Object.entries(obj)) {
      formatted[key] = `${value.toFixed(2)}ms`
    }
    return formatted
  }

  private getAverageLatency(latencies: number[]): number {
    if (latencies.length === 0) return 0
    return latencies.reduce((a, b) => a + b, 0) / latencies.length
  }

  private getPercentile(latencies: number[], percentile: number): number {
    if (latencies.length === 0) return 0
    const sorted = [...latencies].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  /**
   * 导出指标为 JSON（用于分析）
   */
  exportMetrics(): string {
    return JSON.stringify(this.getMetrics(), null, 2)
  }

  /**
   * 重置指标
   */
  reset() {
    this.metrics = {
      dataFetchTimes: {},
      componentRenderTimes: {},
      ipcLatencies: [],
      websocketLatencies: [],
      timestamp: Date.now(),
    }
    this.entries = []
  }
}

// 全局性能监测实例
export const perfMonitor = new PerformanceMonitor()

// 方便的导出函数
export function recordDataFetch(source: string, duration: number) {
  perfMonitor.recordDataFetchTime(source, duration)
}

export function recordComponentRender(componentName: string, duration: number) {
  perfMonitor.recordComponentRenderTime(componentName, duration)
}

export function recordIpcCall(latency: number) {
  perfMonitor.recordIpcLatency(latency)
}

export function recordWebSocket(latency: number) {
  perfMonitor.recordWebSocketLatency(latency)
}

export function printPerfReport() {
  return perfMonitor.printReport()
}

export function exportPerfMetrics() {
  return perfMonitor.exportMetrics()
}
