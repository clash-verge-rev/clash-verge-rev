import {
  TrafficDataSampler,
  formatTrafficName,
} from "../utils/traffic-sampler";

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
  const availableDataPoints = sampler.getDataForTimeRange(
    config.compressedDataMinutes,
  );
  const samplerStats = sampler.getStats();

  const message: ITrafficWorkerSnapshotMessage = {
    type: "snapshot",
    dataPoints,
    availableDataPoints,
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
        name: formatTrafficName(timestamp),
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
