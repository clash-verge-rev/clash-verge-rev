import { useCallback, useEffect, useRef, useState } from "react";
import { Traffic } from "tauri-plugin-mihomo-api";

import type {
  ISamplerStats,
  ITrafficDataPoint,
  ITrafficWorkerSnapshotMessage,
  TrafficWorkerRequestMessage,
  TrafficWorkerResponseMessage,
} from "@/types/traffic-monitor";
import { debugLog } from "@/utils/debug";

export type { ITrafficDataPoint } from "@/types/traffic-monitor";

// 引用计数管理器
class ReferenceCounter {
  private count = 0;
  private callbacks: (() => void)[] = [];

  increment(): () => void {
    this.count++;
    debugLog(`[ReferenceCounter] 引用计数增加: ${this.count}`);

    if (this.count === 1) {
      this.callbacks.forEach((cb) => cb());
    }

    return () => {
      this.count--;
      debugLog(`[ReferenceCounter] 引用计数减少: ${this.count}`);

      if (this.count === 0) {
        this.callbacks.forEach((cb) => cb());
      }
    };
  }

  onCountChange(callback: () => void) {
    this.callbacks.push(callback);
  }

  getCount(): number {
    return this.count;
  }
}

const WORKER_CONFIG = {
  rawDataMinutes: 10,
  compressedDataMinutes: 60,
  compressionRatio: 5,
  snapshotIntervalMs: 250,
  defaultRangeMinutes: 10,
};

class TrafficWorkerClient {
  private worker: Worker | null = null;
  private listeners = new Set<
    (snapshot: ITrafficWorkerSnapshotMessage) => void
  >();
  private pendingMessages: TrafficWorkerRequestMessage[] = [];
  private ready = false;
  private currentRange = WORKER_CONFIG.defaultRangeMinutes;

  start(rangeMinutes?: number) {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      debugLog(
        "[TrafficWorkerClient] Worker not supported in this environment",
      );
      return;
    }

    if (this.worker) return;

    this.currentRange = rangeMinutes ?? this.currentRange;
    this.worker = new Worker(
      new URL("../services/traffic-monitor-worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.onmessage = (
      event: MessageEvent<TrafficWorkerResponseMessage>,
    ) => {
      const message = event.data;
      if (message.type === "snapshot") {
        this.listeners.forEach((listener) => listener(message));
      }
    };

    this.worker.onerror = (error) => {
      debugLog(`[TrafficWorkerClient] Worker error: ${String(error)}`);
    };

    this.ready = true;

    this.post({
      type: "init",
      config: {
        rawDataMinutes: WORKER_CONFIG.rawDataMinutes,
        compressedDataMinutes: WORKER_CONFIG.compressedDataMinutes,
        compressionRatio: WORKER_CONFIG.compressionRatio,
        snapshotIntervalMs: WORKER_CONFIG.snapshotIntervalMs,
        defaultRangeMinutes: this.currentRange,
      },
    });

    this.flushQueue();
  }

  stop() {
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
    this.pendingMessages = [];
  }

  onSnapshot(listener: (snapshot: ITrafficWorkerSnapshotMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private post(message: TrafficWorkerRequestMessage) {
    if (!this.worker || !this.ready) {
      this.pendingMessages.push(message);
      return;
    }
    this.worker.postMessage(message);
  }

  private flushQueue() {
    if (!this.worker || !this.ready || this.pendingMessages.length === 0) {
      return;
    }
    this.pendingMessages.forEach((message) => {
      this.worker?.postMessage(message);
    });
    this.pendingMessages = [];
  }

  appendData(traffic: Traffic) {
    if (!this.worker) {
      this.start(this.currentRange);
    }

    this.post({
      type: "append",
      payload: {
        up: traffic?.up ?? 0,
        down: traffic?.down ?? 0,
        timestamp: Date.now(),
      },
    });
  }

  clearData() {
    this.post({ type: "clear" });
  }

  setRange(minutes: number) {
    this.currentRange = minutes;
    this.post({ type: "setRange", minutes });
  }

  requestSnapshot() {
    this.post({ type: "requestSnapshot" });
  }
}

const refCounter = new ReferenceCounter();
let workerClient: TrafficWorkerClient | null = null;
const getWorkerClient = () => {
  if (!workerClient) {
    workerClient = new TrafficWorkerClient();
  }
  return workerClient;
};

const EMPTY_STATS: ISamplerStats = {
  rawBufferSize: 0,
  compressedBufferSize: 0,
  compressionQueueSize: 0,
  totalMemoryPoints: 0,
};

/**
 * 增强的流量监控Hook - Web Worker驱动的数据采样与压缩
 */
export const useTrafficMonitorEnhanced = () => {
  const [snapshot, setSnapshot] = useState<{
    dataPoints: ITrafficDataPoint[];
    samplerStats: ISamplerStats;
    rangeMinutes: number;
  }>({
    dataPoints: [],
    samplerStats: EMPTY_STATS,
    rangeMinutes: WORKER_CONFIG.defaultRangeMinutes,
  });

  const clientRef = useRef<TrafficWorkerClient | null>(getWorkerClient());
  const currentRangeRef = useRef<number>(WORKER_CONFIG.defaultRangeMinutes);

  // 注册引用计数与Worker生命周期
  useEffect(() => {
    const client = getWorkerClient();
    clientRef.current = client;

    const cleanup = refCounter.increment();
    client.start(currentRangeRef.current);

    const unsubscribe = client.onSnapshot((message) => {
      setSnapshot({
        dataPoints: message.dataPoints,
        samplerStats: message.samplerStats,
        rangeMinutes: message.rangeMinutes,
      });
    });

    client.requestSnapshot();

    return () => {
      unsubscribe();
      cleanup();
      if (refCounter.getCount() === 0) {
        client.stop();
      }
    };
  }, []);

  // 添加流量数据
  const appendData = useCallback((traffic: Traffic) => {
    clientRef.current?.appendData(traffic);
  }, []);

  // 请求不同时间范围的数据
  const requestRange = useCallback((minutes: number) => {
    currentRangeRef.current = minutes;
    clientRef.current?.setRange(minutes);
  }, []);

  // 清空数据
  const clearData = useCallback(() => {
    clientRef.current?.clearData();
  }, []);

  return {
    graphData: {
      dataPoints: snapshot.dataPoints,
      currentRangeMinutes: snapshot.rangeMinutes,
      requestRange,
      appendData,
      clearData,
    },
    samplerStats: snapshot.samplerStats,
    referenceCount: refCounter.getCount(),
  };
};

/**
 * 图表数据Hook
 */
export const useTrafficGraphDataEnhanced = () => {
  const { graphData, samplerStats, referenceCount } =
    useTrafficMonitorEnhanced();

  return {
    ...graphData,
    samplerStats,
    referenceCount,
  };
};
