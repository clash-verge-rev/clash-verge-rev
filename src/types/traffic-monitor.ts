export interface ITrafficDataPoint {
  up: number;
  down: number;
  timestamp: number;
  name: string;
}

export interface ISamplingConfig {
  rawDataMinutes: number;
  compressedDataMinutes: number;
  compressionRatio: number;
}

export interface ISamplerStats {
  rawBufferSize: number;
  compressedBufferSize: number;
  compressionQueueSize: number;
  totalMemoryPoints: number;
}

export interface ITrafficWorkerInitMessage {
  type: "init";
  config: ISamplingConfig & {
    snapshotIntervalMs: number;
    defaultRangeMinutes: number;
  };
}

export interface ITrafficWorkerAppendMessage {
  type: "append";
  payload: {
    up: number;
    down: number;
    timestamp?: number;
  };
}

export interface ITrafficWorkerClearMessage {
  type: "clear";
}

export interface ITrafficWorkerSetRangeMessage {
  type: "setRange";
  minutes: number;
}

export interface ITrafficWorkerRequestSnapshotMessage {
  type: "requestSnapshot";
}

export type TrafficWorkerRequestMessage =
  | ITrafficWorkerInitMessage
  | ITrafficWorkerAppendMessage
  | ITrafficWorkerClearMessage
  | ITrafficWorkerSetRangeMessage
  | ITrafficWorkerRequestSnapshotMessage;

export interface ITrafficWorkerSnapshotMessage {
  type: "snapshot";
  dataPoints: ITrafficDataPoint[];
  availableDataPoints: ITrafficDataPoint[];
  samplerStats: ISamplerStats;
  rangeMinutes: number;
  lastTimestamp?: number;
  reason:
    | "init"
    | "interval"
    | "range-change"
    | "request"
    | "append-throttle"
    | "clear";
}

export interface ITrafficWorkerLogMessage {
  type: "log";
  message: string;
}

export type TrafficWorkerResponseMessage =
  | ITrafficWorkerSnapshotMessage
  | ITrafficWorkerLogMessage;
