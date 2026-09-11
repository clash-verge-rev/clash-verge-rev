import { TrafficDataSampler, isSameTrafficData } from '../utils/traffic-sampler'

const DEFAULT_CONFIG: ISamplingConfig & {
  snapshotIntervalMs: number
  defaultRangeMinutes: number
} = {
  rawDataMinutes: 10,
  compressedDataMinutes: 60,
  compressionRatio: 5,
  snapshotIntervalMs: 250,
  defaultRangeMinutes: 10,
}

interface WorkerScope {
  postMessage: (message: unknown) => void
  onmessage: ((event: MessageEvent<TrafficWorkerRequestMessage>) => void) | null
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
}

const ctx: WorkerScope = self as unknown as WorkerScope

let config = { ...DEFAULT_CONFIG }
let sampler = new TrafficDataSampler(config)
let currentRangeMinutes = config.defaultRangeMinutes
let throttleTimer: ReturnType<typeof setTimeout> | null = null
let lastTimestamp: number | undefined
let lastBroadcast: ITrafficDataPoint[] = []

const broadcastSnapshot = (reason: ITrafficWorkerSnapshotMessage['reason']) => {
  const dataPoints = sampler.getDataForTimeRange(currentRangeMinutes)
  const samplerStats = sampler.getStats()

  const message: ITrafficWorkerSnapshotMessage = {
    type: 'snapshot',
    dataPoints,
    samplerStats,
    rangeMinutes: currentRangeMinutes,
    lastTimestamp,
    reason,
  }

  ctx.postMessage(message)
  lastBroadcast = dataPoints
}

const scheduleSnapshot = (reason: ITrafficWorkerSnapshotMessage['reason']) => {
  if (throttleTimer !== null) return
  throttleTimer = ctx.setTimeout(() => {
    throttleTimer = null
    broadcastSnapshot(reason)
  }, config.snapshotIntervalMs)
}

ctx.onmessage = (event: MessageEvent<TrafficWorkerRequestMessage>) => {
  const message = event.data

  switch (message.type) {
    case 'init': {
      config = { ...message.config }
      sampler = new TrafficDataSampler(config)
      currentRangeMinutes = message.config.defaultRangeMinutes
      // Re-broadcast when points age out of the range, not on every tick;
      // no handle needed, worker teardown (terminate) drops pending timers
      ctx.setInterval(() => {
        if (throttleTimer !== null) return
        const slice = sampler.getDataForTimeRange(currentRangeMinutes)
        if (!isSameTrafficData(lastBroadcast, slice)) {
          broadcastSnapshot('interval')
        }
      }, 1000)
      broadcastSnapshot('init')
      break
    }
    case 'append': {
      const timestamp = message.payload.timestamp ?? Date.now()
      const dataPoint: ITrafficDataPoint = {
        up: message.payload.up || 0,
        down: message.payload.down || 0,
        timestamp,
      }

      lastTimestamp = timestamp
      sampler.addDataPoint(dataPoint)
      scheduleSnapshot('append-throttle')
      break
    }
    case 'clear': {
      sampler.clear()
      lastTimestamp = undefined
      broadcastSnapshot('clear')
      break
    }
    case 'setRange': {
      if (currentRangeMinutes !== message.minutes) {
        currentRangeMinutes = message.minutes
        broadcastSnapshot('range-change')
      }
      break
    }
    case 'requestSnapshot': {
      broadcastSnapshot('request')
      break
    }
    default:
      break
  }
}
