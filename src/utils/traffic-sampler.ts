interface ICompressedDataPoint {
  up: number
  down: number
  timestamp: number
  samples: number
}

const pad2 = (value: number) => value.toString().padStart(2, '0')

// Time labels are derived once per 1Hz timestamp and redrawn several times per
// second; the bounded cache keeps axis drawing allocation-free in steady state.
const TIME_LABEL_CACHE_LIMIT = 1024
const hourMinuteLabels = new Map<number, string>()
const minuteSecondLabels = new Map<number, string>()

export const formatTrafficHourMinute = (timestamp: number) => {
  const cached = hourMinuteLabels.get(timestamp)
  if (cached !== undefined) return cached

  const date = new Date(timestamp)
  const label = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (hourMinuteLabels.size >= TIME_LABEL_CACHE_LIMIT) hourMinuteLabels.clear()
  hourMinuteLabels.set(timestamp, label)
  return label
}

export const formatTrafficMinuteSecond = (timestamp: number) => {
  const cached = minuteSecondLabels.get(timestamp)
  if (cached !== undefined) return cached

  const date = new Date(timestamp)
  const label = `${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  if (minuteSecondLabels.size >= TIME_LABEL_CACHE_LIMIT)
    minuteSecondLabels.clear()
  minuteSecondLabels.set(timestamp, label)
  return label
}

export const formatTrafficName = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`
}

export const isSameTrafficData = (
  current: ITrafficDataPoint[],
  next: ITrafficDataPoint[],
) => {
  if (current === next) return true
  if (current.length !== next.length) return false

  for (let i = 0; i < current.length; i++) {
    const currentPoint = current[i]
    const nextPoint = next[i]

    if (
      currentPoint.timestamp !== nextPoint.timestamp ||
      currentPoint.up !== nextPoint.up ||
      currentPoint.down !== nextPoint.down
    ) {
      return false
    }
  }

  return true
}

export class TrafficDataSampler {
  private rawBuffer: ITrafficDataPoint[] = []
  private rawHead = 0
  private compressedBuffer: ICompressedDataPoint[] = []
  private compressedHead = 0
  private compressionQueue: ITrafficDataPoint[] = []
  private version = 0

  constructor(private config: ISamplingConfig) {}

  addDataPoint(point: ITrafficDataPoint) {
    this.version++
    this.rawBuffer.push(point)

    const rawCutoff = Date.now() - this.config.rawDataMinutes * 60 * 1000
    // O(1) amortized trimming using moving head; compact occasionally
    while (
      this.rawHead < this.rawBuffer.length &&
      this.rawBuffer[this.rawHead]?.timestamp <= rawCutoff
    ) {
      this.rawHead++
    }
    if (this.rawHead > 512 && this.rawHead > this.rawBuffer.length / 2) {
      this.rawBuffer = this.rawBuffer.slice(this.rawHead)
      this.rawHead = 0
    }

    this.compressionQueue.push(point)
    if (this.compressionQueue.length >= this.config.compressionRatio) {
      this.compressData()
    }

    const compressedCutoff =
      Date.now() - this.config.compressedDataMinutes * 60 * 1000
    while (
      this.compressedHead < this.compressedBuffer.length &&
      this.compressedBuffer[this.compressedHead]?.timestamp <= compressedCutoff
    ) {
      this.compressedHead++
    }
    if (
      this.compressedHead > 256 &&
      this.compressedHead > this.compressedBuffer.length / 2
    ) {
      this.compressedBuffer = this.compressedBuffer.slice(this.compressedHead)
      this.compressedHead = 0
    }
  }

  private compressData() {
    if (this.compressionQueue.length === 0) return

    const totalUp = this.compressionQueue.reduce((sum, p) => sum + p.up, 0)
    const totalDown = this.compressionQueue.reduce((sum, p) => sum + p.down, 0)
    const avgTimestamp =
      this.compressionQueue.reduce((sum, p) => sum + p.timestamp, 0) /
      this.compressionQueue.length

    const compressedPoint: ICompressedDataPoint = {
      up: totalUp / this.compressionQueue.length,
      down: totalDown / this.compressionQueue.length,
      timestamp: avgTimestamp,
      samples: this.compressionQueue.length,
    }

    this.compressedBuffer.push(compressedPoint)
    this.compressionQueue = []
  }

  getDataForTimeRange(minutes: number): ITrafficDataPoint[] {
    const cutoff = Date.now() - minutes * 60 * 1000

    let rawStart = this.rawHead
    while (
      rawStart < this.rawBuffer.length &&
      this.rawBuffer[rawStart]?.timestamp <= cutoff
    ) {
      rawStart++
    }
    const rawCount = this.rawBuffer.length - rawStart

    if (minutes <= this.config.rawDataMinutes) {
      return this.rawBuffer.slice(rawStart)
    }

    const compressedCutoffUpper =
      Date.now() - this.config.rawDataMinutes * 60 * 1000

    let compressedStart = this.compressedHead
    while (
      compressedStart < this.compressedBuffer.length &&
      this.compressedBuffer[compressedStart]?.timestamp <= cutoff
    ) {
      compressedStart++
    }
    let compressedEnd = compressedStart
    while (
      compressedEnd < this.compressedBuffer.length &&
      this.compressedBuffer[compressedEnd].timestamp <= compressedCutoffUpper
    ) {
      compressedEnd++
    }

    // Single preallocated result; raw entries keep their stored identity.
    const compressedCount = compressedEnd - compressedStart
    const result: ITrafficDataPoint[] = new Array(compressedCount + rawCount)
    for (let i = 0; i < compressedCount; i++) {
      const point = this.compressedBuffer[compressedStart + i]
      result[i] = {
        up: point.up,
        down: point.down,
        timestamp: point.timestamp,
      }
    }
    for (let i = 0; i < rawCount; i++) {
      result[compressedCount + i] = this.rawBuffer[rawStart + i]
    }

    // Compressed points precede raw ones except across the trim boundary;
    // sort only when the two ranges actually interleave.
    if (
      compressedCount > 0 &&
      rawCount > 0 &&
      this.compressedBuffer[compressedEnd - 1].timestamp >
        this.rawBuffer[rawStart].timestamp
    ) {
      result.sort((a, b) => a.timestamp - b.timestamp)
    }
    return result
  }

  getStats(): ISamplerStats {
    return {
      rawBufferSize: this.rawBuffer.length - this.rawHead,
      compressedBufferSize: this.compressedBuffer.length - this.compressedHead,
      compressionQueueSize: this.compressionQueue.length,
      totalMemoryPoints:
        this.rawBuffer.length -
        this.rawHead +
        (this.compressedBuffer.length - this.compressedHead),
    }
  }

  /** Bumped by every mutation (added points, compression, aging trims, clear). */
  getVersion(): number {
    return this.version
  }

  clear() {
    this.version++
    this.rawBuffer = []
    this.rawHead = 0
    this.compressedBuffer = []
    this.compressedHead = 0
    this.compressionQueue = []
  }
}
