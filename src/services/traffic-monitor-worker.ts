import { TrafficDataSampler, isSameTrafficData } from '../utils/traffic-sampler'

interface WorkerScope {
  postMessage: (message: unknown) => void
  onmessage: ((event: MessageEvent<TrafficWorkerRequestMessage>) => void) | null
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
}

const ctx: WorkerScope = self as unknown as WorkerScope

// 'init' is the first message posted by the client, so these are always
// assigned before first use.
let config!: ITrafficWorkerInitMessage['config']
let sampler!: TrafficDataSampler
let currentRangeMinutes!: number
let throttleTimer: ReturnType<typeof setTimeout> | null = null
let lastTimestamp: number | undefined
let lastBroadcast: ITrafficDataPoint[] = []
let lastSamplerVersion = 0

// The slice for `minutes` can only change without new samples when its oldest
// point ages past the range cutoff.
const agedPastRange = (reference: ITrafficDataPoint[], minutes: number) =>
  reference.length > 0 &&
  Date.now() - reference[0].timestamp >= minutes * 60 * 1000

const broadcastSnapshot = () => {
  const dataPoints = sampler.getDataForTimeRange(currentRangeMinutes)
  const samplerStats = sampler.getStats()

  const message: ITrafficWorkerSnapshotMessage = {
    type: 'snapshot',
    dataPoints,
    samplerStats,
    lastTimestamp,
  }

  ctx.postMessage(message)
  lastBroadcast = dataPoints
  lastSamplerVersion = sampler.getVersion()
}

const scheduleSnapshot = () => {
  if (throttleTimer !== null) return
  throttleTimer = ctx.setTimeout(() => {
    throttleTimer = null
    broadcastSnapshot()
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
        const version = sampler.getVersion()
        if (
          version === lastSamplerVersion &&
          !agedPastRange(lastBroadcast, currentRangeMinutes)
        ) {
          return
        }
        const slice = sampler.getDataForTimeRange(currentRangeMinutes)
        if (!isSameTrafficData(lastBroadcast, slice)) {
          broadcastSnapshot()
        } else {
          lastSamplerVersion = version
        }
      }, 1000)
      broadcastSnapshot()
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
      scheduleSnapshot()
      break
    }
    case 'setRange': {
      if (currentRangeMinutes !== message.minutes) {
        currentRangeMinutes = message.minutes
        broadcastSnapshot()
      }
      break
    }
    case 'requestSnapshot': {
      broadcastSnapshot()
      break
    }
    default:
      break
  }
}
