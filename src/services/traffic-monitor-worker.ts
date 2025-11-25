import type {
  ISamplingConfig,
  ITrafficDataPoint,
  ITrafficWorkerSnapshotMessage,
  TrafficWorkerRequestMessage,
} from "../types/traffic-monitor";

interface ICompressedDataPoint {
  up: number;
  down: number;
  timestamp: number;
  samples: number;
}

const DEFAULT_CONFIG: ISamplingConfig & {
  snapshotIntervalMs: number;
  defaultRangeMinutes: number;
} = {
  rawDataMinutes: 10,
  compressedDataMinutes: 60,
  compressionRatio: 5,
  snapshotIntervalMs: 250,
  defaultRangeMinutes: 10,
};

const formatName = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

class TrafficDataSampler {
  private rawBuffer: ITrafficDataPoint[] = [];
  private compressedBuffer: ICompressedDataPoint[] = [];
  private compressionQueue: ITrafficDataPoint[] = [];

  constructor(private config: ISamplingConfig) {}

  addDataPoint(point: ITrafficDataPoint) {
    this.rawBuffer.push(point);

    const rawCutoff = Date.now() - this.config.rawDataMinutes * 60 * 1000;
    this.rawBuffer = this.rawBuffer.filter((p) => p.timestamp > rawCutoff);

    this.compressionQueue.push(point);
    if (this.compressionQueue.length >= this.config.compressionRatio) {
      this.compressData();
    }

    const compressedCutoff =
      Date.now() - this.config.compressedDataMinutes * 60 * 1000;
    this.compressedBuffer = this.compressedBuffer.filter(
      (p) => p.timestamp > compressedCutoff,
    );
  }

  private compressData() {
    if (this.compressionQueue.length === 0) return;

    const totalUp = this.compressionQueue.reduce((sum, p) => sum + p.up, 0);
    const totalDown = this.compressionQueue.reduce((sum, p) => sum + p.down, 0);
    const avgTimestamp =
      this.compressionQueue.reduce((sum, p) => sum + p.timestamp, 0) /
      this.compressionQueue.length;

    const compressedPoint: ICompressedDataPoint = {
      up: totalUp / this.compressionQueue.length,
      down: totalDown / this.compressionQueue.length,
      timestamp: avgTimestamp,
      samples: this.compressionQueue.length,
    };

    this.compressedBuffer.push(compressedPoint);
    this.compressionQueue = [];
  }

  getDataForTimeRange(minutes: number): ITrafficDataPoint[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const rawData = this.rawBuffer.filter((p) => p.timestamp > cutoff);

    if (minutes <= this.config.rawDataMinutes) {
      return rawData;
    }

    const compressedData = this.compressedBuffer
      .filter(
        (p) =>
          p.timestamp > cutoff &&
          p.timestamp <= Date.now() - this.config.rawDataMinutes * 60 * 1000,
      )
      .map((p) => ({
        up: p.up,
        down: p.down,
        timestamp: p.timestamp,
        name: formatName(p.timestamp),
      }));

    return [...compressedData, ...rawData].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  getStats() {
    return {
      rawBufferSize: this.rawBuffer.length,
      compressedBufferSize: this.compressedBuffer.length,
      compressionQueueSize: this.compressionQueue.length,
      totalMemoryPoints: this.rawBuffer.length + this.compressedBuffer.length,
    };
  }

  clear() {
    this.rawBuffer = [];
    this.compressedBuffer = [];
    this.compressionQueue = [];
  }
}

interface WorkerScope {
  postMessage: (message: unknown) => void;
  onmessage:
    | ((event: MessageEvent<TrafficWorkerRequestMessage>) => void)
    | null;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

const ctx: WorkerScope = self as unknown as WorkerScope;

let config = { ...DEFAULT_CONFIG };
let sampler = new TrafficDataSampler(config);
let currentRangeMinutes = config.defaultRangeMinutes;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let lastTimestamp: number | undefined;

const broadcastSnapshot = (reason: ITrafficWorkerSnapshotMessage["reason"]) => {
  const dataPoints = sampler.getDataForTimeRange(currentRangeMinutes);
  const samplerStats = sampler.getStats();

  const message: ITrafficWorkerSnapshotMessage = {
    type: "snapshot",
    dataPoints,
    samplerStats,
    rangeMinutes: currentRangeMinutes,
    lastTimestamp,
    reason,
  };

  ctx.postMessage(message);
};

const scheduleSnapshot = (reason: ITrafficWorkerSnapshotMessage["reason"]) => {
  if (throttleTimer !== null) return;
  throttleTimer = ctx.setTimeout(() => {
    throttleTimer = null;
    broadcastSnapshot(reason);
  }, config.snapshotIntervalMs);
};

ctx.onmessage = (event: MessageEvent<TrafficWorkerRequestMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "init": {
      config = { ...message.config };
      sampler = new TrafficDataSampler(config);
      currentRangeMinutes = message.config.defaultRangeMinutes;
      broadcastSnapshot("init");
      break;
    }
    case "append": {
      const timestamp = message.payload.timestamp ?? Date.now();
      const dataPoint: ITrafficDataPoint = {
        up: message.payload.up || 0,
        down: message.payload.down || 0,
        timestamp,
        name: formatName(timestamp),
      };

      lastTimestamp = timestamp;
      sampler.addDataPoint(dataPoint);
      scheduleSnapshot("append-throttle");
      break;
    }
    case "clear": {
      sampler.clear();
      lastTimestamp = undefined;
      broadcastSnapshot("clear");
      break;
    }
    case "setRange": {
      if (currentRangeMinutes !== message.minutes) {
        currentRangeMinutes = message.minutes;
        broadcastSnapshot("range-change");
      }
      break;
    }
    case "requestSnapshot": {
      broadcastSnapshot("request");
      break;
    }
    default:
      break;
  }
};
