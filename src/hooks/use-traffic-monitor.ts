import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Traffic } from "tauri-plugin-mihomo-api";

import { debugLog } from "@/utils/debug";
import { TrafficDataSampler, formatTrafficName } from "@/utils/traffic-sampler";

// 引用计数管理器
class ReferenceCounter {
  private count = 0;
  private callbacks = new Set<() => void>();

  private notify() {
    this.callbacks.forEach((cb) => cb());
  }

  increment(): () => void {
    this.count++;
    debugLog(`[ReferenceCounter] 引用计数增加: ${this.count}`);

    this.notify();

    return () => {
      this.count--;
      debugLog(`[ReferenceCounter] 引用计数减少: ${this.count}`);

      this.notify();
    };
  }

  onCountChange(callback: () => void) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
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

class InlineTrafficMonitor {
  private config = { ...WORKER_CONFIG };
  private sampler = new TrafficDataSampler(this.config);
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRange = this.config.defaultRangeMinutes;
  private lastTimestamp: number | undefined;

  constructor(
    private emit: (snapshot: ITrafficWorkerSnapshotMessage) => void,
  ) {}

  start(rangeMinutes?: number) {
    this.currentRange = rangeMinutes ?? this.currentRange;
    this.handle({
      type: "init",
      config: {
        ...this.config,
        defaultRangeMinutes: this.currentRange,
      },
    });
  }

  stop() {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.sampler.clear();
    this.lastTimestamp = undefined;
  }

  handle(message: TrafficWorkerRequestMessage) {
    switch (message.type) {
      case "init": {
        this.config = { ...message.config };
        this.sampler = new TrafficDataSampler(this.config);
        this.currentRange = message.config.defaultRangeMinutes;
        this.emitSnapshot("init");
        break;
      }
      case "append": {
        const timestamp = message.payload.timestamp ?? Date.now();
        const dataPoint: ITrafficDataPoint = {
          up: message.payload.up || 0,
          down: message.payload.down || 0,
          timestamp,
          name: formatTrafficName(timestamp),
        };

        this.lastTimestamp = timestamp;
        this.sampler.addDataPoint(dataPoint);
        this.scheduleSnapshot("append-throttle");
        break;
      }
      case "clear": {
        this.sampler.clear();
        this.lastTimestamp = undefined;
        this.emitSnapshot("clear");
        break;
      }
      case "setRange": {
        if (this.currentRange !== message.minutes) {
          this.currentRange = message.minutes;
          this.emitSnapshot("range-change");
        }
        break;
      }
      case "requestSnapshot": {
        this.emitSnapshot("request");
        break;
      }
      default:
        break;
    }
  }

  private emitSnapshot(reason: ITrafficWorkerSnapshotMessage["reason"]) {
    const dataPoints = this.sampler.getDataForTimeRange(this.currentRange);
    const availableDataPoints = this.sampler.getDataForTimeRange(
      this.config.compressedDataMinutes,
    );

    this.emit({
      type: "snapshot",
      dataPoints,
      availableDataPoints,
      samplerStats: this.sampler.getStats(),
      rangeMinutes: this.currentRange,
      lastTimestamp: this.lastTimestamp,
      reason,
    });
  }

  private scheduleSnapshot(reason: ITrafficWorkerSnapshotMessage["reason"]) {
    if (this.throttleTimer !== null) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.emitSnapshot(reason);
    }, this.config.snapshotIntervalMs);
  }
}

class TrafficWorkerClient {
  private worker: Worker | null = null;
  private inlineMonitor: InlineTrafficMonitor | null = null;
  private mode: "worker" | "inline" | null = null;
  private listeners = new Set<
    (snapshot: ITrafficWorkerSnapshotMessage) => void
  >();
  private pendingMessages: TrafficWorkerRequestMessage[] = [];
  private ready = false;
  private currentRange = WORKER_CONFIG.defaultRangeMinutes;

  start(rangeMinutes?: number) {
    if (typeof window === "undefined") {
      debugLog("[TrafficWorkerClient] Window not available, skip start");
      return;
    }

    this.currentRange = rangeMinutes ?? this.currentRange;

    if (this.ready) return;

    const initMessage: TrafficWorkerRequestMessage = {
      type: "init",
      config: {
        rawDataMinutes: WORKER_CONFIG.rawDataMinutes,
        compressedDataMinutes: WORKER_CONFIG.compressedDataMinutes,
        compressionRatio: WORKER_CONFIG.compressionRatio,
        snapshotIntervalMs: WORKER_CONFIG.snapshotIntervalMs,
        defaultRangeMinutes: this.currentRange,
      },
    };

    if (typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(
          new URL("../services/traffic-monitor-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.mode = "worker";

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
        this.post(initMessage);
        this.flushQueue();
        return;
      } catch (error) {
        debugLog(
          `[TrafficWorkerClient] Worker initialization failed, falling back to inline sampler: ${String(error)}`,
        );
        this.worker = null;
        this.mode = null;
      }
    } else {
      debugLog(
        "[TrafficWorkerClient] Worker not supported, using inline sampler",
      );
    }

    this.startInline(initMessage);
  }

  private startInline(initMessage: TrafficWorkerRequestMessage) {
    this.inlineMonitor = new InlineTrafficMonitor((snapshot) =>
      this.listeners.forEach((listener) => listener(snapshot)),
    );
    this.mode = "inline";
    this.ready = true;
    this.post(initMessage);
    this.flushQueue();
  }

  stop() {
    if (this.worker) {
      this.worker.terminate();
    }
    if (this.inlineMonitor) {
      this.inlineMonitor.stop();
    }
    this.worker = null;
    this.inlineMonitor = null;
    this.mode = null;
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
    if (!this.ready) {
      this.pendingMessages.push(message);
      return;
    }

    if (this.mode === "worker" && this.worker) {
      this.worker.postMessage(message);
      return;
    }

    if (this.mode === "inline" && this.inlineMonitor) {
      this.inlineMonitor.handle(message);
      return;
    }

    this.pendingMessages.push(message);
  }

  private flushQueue() {
    if (!this.ready || this.pendingMessages.length === 0) {
      return;
    }
    const queued = [...this.pendingMessages];
    this.pendingMessages = [];
    queued.forEach((message) => {
      this.post(message);
    });
  }

  private ensureStarted() {
    if (!this.ready) {
      this.start(this.currentRange);
    }
  }

  appendData(traffic: Traffic) {
    this.ensureStarted();
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
    this.ensureStarted();
    this.post({ type: "clear" });
  }

  setRange(minutes: number) {
    this.currentRange = minutes;
    this.post({ type: "setRange", minutes });
  }

  requestSnapshot() {
    this.ensureStarted();
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
export const useTrafficMonitorEnhanced = (options?: {
  subscribe?: boolean;
}) => {
  const subscribeToSnapshots = options?.subscribe ?? true;
  const [latestSnapshot, setLatestSnapshot] = useState<{
    availableDataPoints: ITrafficDataPoint[];
    samplerStats: ISamplerStats;
    lastTimestamp?: number;
  }>({
    availableDataPoints: [],
    samplerStats: EMPTY_STATS,
    lastTimestamp: undefined,
  });
  const [rangeMinutes, setRangeMinutes] = useState(
    WORKER_CONFIG.defaultRangeMinutes,
  );
  const [now, setNow] = useState(() => Date.now());
  const [, forceRefCountRender] = useReducer((value) => value + 1, 0);

  const clientRef = useRef<TrafficWorkerClient | null>(getWorkerClient());
  const currentRangeRef = useRef<number>(WORKER_CONFIG.defaultRangeMinutes);

  // 注册引用计数与Worker生命周期
  useEffect(() => {
    const client = getWorkerClient();
    clientRef.current = client;

    const stopWatchRefCount = refCounter.onCountChange(() =>
      forceRefCountRender(),
    );
    const cleanup = refCounter.increment();
    client.start(currentRangeRef.current);

    let unsubscribe: (() => void) | undefined;
    if (subscribeToSnapshots) {
      unsubscribe = client.onSnapshot((message) => {
        setLatestSnapshot({
          availableDataPoints:
            message.availableDataPoints ?? message.dataPoints,
          samplerStats: message.samplerStats,
          lastTimestamp: message.lastTimestamp,
        });
      });

      client.requestSnapshot();
    }

    return () => {
      unsubscribe?.();
      stopWatchRefCount();
      cleanup();
      if (refCounter.getCount() === 0) {
        client.stop();
      }
    };
  }, [subscribeToSnapshots]);

  // Periodically refresh "now" so idle streams age out of the selected window when subscribed
  useEffect(() => {
    if (!subscribeToSnapshots) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [subscribeToSnapshots]);

  // 添加流量数据
  const appendData = useCallback((traffic: Traffic) => {
    clientRef.current?.appendData(traffic);
  }, []);

  // 请求不同时间范围的数据
  const requestRange = useCallback((minutes: number) => {
    currentRangeRef.current = minutes;
    setRangeMinutes(minutes);
    clientRef.current?.setRange(minutes);
  }, []);

  // 清空数据
  const clearData = useCallback(() => {
    clientRef.current?.clearData();
  }, []);

  const filteredDataPoints = useMemo(() => {
    const sourceData = latestSnapshot.availableDataPoints;
    if (sourceData.length === 0) return [];

    const cutoff = now - rangeMinutes * 60 * 1000;
    return sourceData.filter((point) => point.timestamp > cutoff);
  }, [latestSnapshot.availableDataPoints, rangeMinutes, now]);

  return {
    graphData: {
      dataPoints: filteredDataPoints,
      currentRangeMinutes: rangeMinutes,
      requestRange,
      appendData,
      clearData,
    },
    samplerStats: latestSnapshot.samplerStats,
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
