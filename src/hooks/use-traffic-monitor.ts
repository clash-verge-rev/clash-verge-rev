import { useCallback, useEffect, useRef, useState } from 'react'
import { Traffic } from 'tauri-plugin-mihomo-api'

import { useVisibility } from '@/hooks/use-visibility'
import { debugLog } from '@/utils/debug'

// 引用计数管理器
class ReferenceCounter {
  private count = 0

  increment(): () => void {
    this.count++
    debugLog(`[ReferenceCounter] 引用计数增加: ${this.count}`)

    return () => {
      this.count--
      debugLog(`[ReferenceCounter] 引用计数减少: ${this.count}`)
    }
  }

  getCount(): number {
    return this.count
  }
}

const WORKER_CONFIG = {
  rawDataMinutes: 10,
  compressedDataMinutes: 60,
  compressionRatio: 5,
  snapshotIntervalMs: 200,
  defaultRangeMinutes: 10,
}

class TrafficWorkerClient {
  private worker: Worker | null = null
  private listeners = new Set<
    (snapshot: ITrafficWorkerSnapshotMessage) => void
  >()
  private currentRange = WORKER_CONFIG.defaultRangeMinutes

  start(rangeMinutes?: number) {
    if (typeof window === 'undefined') {
      debugLog('[TrafficWorkerClient] Window not available, skip start')
      return
    }

    this.currentRange = rangeMinutes ?? this.currentRange

    if (this.worker) return

    const initMessage: TrafficWorkerRequestMessage = {
      type: 'init',
      config: { ...WORKER_CONFIG, defaultRangeMinutes: this.currentRange },
    }

    this.worker = new Worker(
      new URL('../services/traffic-monitor-worker.ts', import.meta.url),
      { type: 'module' },
    )

    this.worker.onmessage = (
      event: MessageEvent<TrafficWorkerResponseMessage>,
    ) => {
      const message = event.data
      if (message.type === 'snapshot') {
        if (import.meta.env.MODE === 'perf') {
          document.documentElement.dataset.perfWorker = String(
            message.lastTimestamp ?? 0,
          )
          document.documentElement.dataset.perfPoints = String(
            message.dataPoints.length,
          )
          const last = message.dataPoints.at(-1)
          document.documentElement.dataset.perfLastUp = String(last?.up ?? 0)
          document.documentElement.dataset.perfLastDown = String(
            last?.down ?? 0,
          )
        }
        this.listeners.forEach((listener) => {
          listener(message)
        })
      }
    }

    this.worker.onerror = (error) => {
      debugLog(`[TrafficWorkerClient] Worker error: ${String(error)}`)
    }

    this.post(initMessage)
  }

  stop() {
    this.worker?.terminate()
    this.worker = null
  }

  onSnapshot(listener: (snapshot: ITrafficWorkerSnapshotMessage) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private post(message: TrafficWorkerRequestMessage) {
    this.worker?.postMessage(message)
  }

  private ensureStarted() {
    if (!this.worker) {
      this.start(this.currentRange)
    }
  }

  appendData(traffic: Traffic) {
    this.ensureStarted()
    this.post({
      type: 'append',
      payload: {
        up: traffic?.up ?? 0,
        down: traffic?.down ?? 0,
        timestamp: Date.now(),
      },
    })
  }

  setRange(minutes: number) {
    this.currentRange = minutes
    this.post({ type: 'setRange', minutes })
  }

  requestSnapshot() {
    this.ensureStarted()
    this.post({ type: 'requestSnapshot' })
  }
}

const refCounter = new ReferenceCounter()
let workerClient: TrafficWorkerClient | null = null
const getWorkerClient = () => {
  if (!workerClient) {
    workerClient = new TrafficWorkerClient()
  }
  return workerClient
}

const EMPTY_STATS: ISamplerStats = {
  rawBufferSize: 0,
  compressedBufferSize: 0,
  compressionQueueSize: 0,
  totalMemoryPoints: 0,
}

const EMPTY_DATA: ITrafficDataPoint[] = []

/**
 * 增强的流量监控Hook - Web Worker驱动的数据采样与压缩
 */
export const useTrafficMonitorEnhanced = (options?: {
  subscribe?: boolean
  enabled?: boolean
}) => {
  const subscribeToSnapshots = options?.subscribe ?? true
  const enabled = options?.enabled ?? true
  const isVisible = useVisibility()
  const [latestSnapshot, setLatestSnapshot] = useState<{
    dataPoints: ITrafficDataPoint[]
    samplerStats: ISamplerStats
  }>({
    dataPoints: [],
    samplerStats: EMPTY_STATS,
  })

  const clientRef = useRef<TrafficWorkerClient | null>(getWorkerClient())
  const currentRangeRef = useRef<number>(WORKER_CONFIG.defaultRangeMinutes)
  const isVisibleRef = useRef(isVisible)
  isVisibleRef.current = isVisible

  // 注册引用计数与Worker生命周期
  useEffect(() => {
    if (!enabled) return

    const client = getWorkerClient()
    clientRef.current = client

    const cleanup = refCounter.increment()
    client.start(currentRangeRef.current)

    let unsubscribe: (() => void) | undefined
    if (subscribeToSnapshots) {
      unsubscribe = client.onSnapshot((message) => {
        if (!isVisibleRef.current) return
        setLatestSnapshot({
          dataPoints: message.dataPoints,
          samplerStats: message.samplerStats,
        })
      })
    }

    return () => {
      unsubscribe?.()
      cleanup()
      if (refCounter.getCount() === 0) {
        client.stop()
      }
    }
  }, [enabled, subscribeToSnapshots])

  // Re-prime snapshot ingestion after every visible transition
  useEffect(() => {
    if (enabled && subscribeToSnapshots && isVisible) {
      clientRef.current?.requestSnapshot()
    }
  }, [enabled, subscribeToSnapshots, isVisible])

  // 添加流量数据
  const appendData = useCallback(
    (traffic: Traffic) => {
      if (!enabled) return
      clientRef.current?.appendData(traffic)
    },
    [enabled],
  )

  // 请求不同时间范围的数据
  const requestRange = useCallback(
    (minutes: number) => {
      if (!enabled) return
      currentRangeRef.current = minutes
      clientRef.current?.setRange(minutes)
    },
    [enabled],
  )

  return {
    graphData: {
      dataPoints: enabled ? latestSnapshot.dataPoints : EMPTY_DATA,
      requestRange,
      appendData,
    },
    samplerStats: latestSnapshot.samplerStats,
  }
}

/**
 * 图表数据Hook
 */
export const useTrafficGraphDataEnhanced = () => {
  const { graphData, samplerStats } = useTrafficMonitorEnhanced()

  return {
    ...graphData,
    samplerStats,
  }
}
