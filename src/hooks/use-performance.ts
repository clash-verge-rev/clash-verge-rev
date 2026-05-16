import { useEffect, useRef } from 'react'

import { perfMonitor } from '@/services/performance-monitor'

/**
 * Hook: 监测组件渲染性能
 */
export function useRenderPerformance(componentName: string) {
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    startTimeRef.current = performance.now()
    const measureFrame = requestAnimationFrame(() => {
      if (startTimeRef.current === null) return
      const endTime = performance.now()
      const duration = endTime - startTimeRef.current
      perfMonitor.recordComponentRenderTime(componentName, duration)
    })

    return () => cancelAnimationFrame(measureFrame)
  }, [componentName])
}

/**
 * Hook: 监测数据加载性能
 */
export function useDataFetchPerformance<T>(
  queryKey: string,
  isPending: boolean,
  data?: T,
) {
  const startTimeRef = useRef<number | null>(null)
  const hasReportedRef = useRef(false)

  useEffect(() => {
    if (isPending) {
      startTimeRef.current = performance.now()
      hasReportedRef.current = false
    } else if (!isPending && !hasReportedRef.current && data !== undefined) {
      if (startTimeRef.current === null) return
      const duration = performance.now() - startTimeRef.current
      perfMonitor.recordDataFetchTime(queryKey, duration)
      hasReportedRef.current = true
    }
  }, [isPending, data, queryKey])
}

/**
 * Hook: 定期导出性能指标
 */
export function usePerformanceExport(intervalMs: number = 60000) {
  useEffect(() => {
    const interval = setInterval(() => {
      const metrics = perfMonitor.exportMetrics()
      // 可以发送到服务器或保存到 localStorage
      localStorage.setItem('perf_metrics_latest', metrics)
      console.debug('Performance metrics exported')
    }, intervalMs)

    return () => clearInterval(interval)
  }, [intervalMs])
}

/**
 * Hook: 获取当前性能指标
 */
export function usePerformanceMetrics() {
  const [metrics, setMetrics] = React.useState(() => perfMonitor.getMetrics())

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(perfMonitor.getMetrics())
    }, 5000) // 每 5 秒更新一次

    return () => clearInterval(interval)
  }, [])

  return metrics
}
