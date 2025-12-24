interface ICompressedDataPoint {
  up: number;
  down: number;
  timestamp: number;
  samples: number;
}

export const formatTrafficName = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export class TrafficDataSampler {
  private rawBuffer: ITrafficDataPoint[] = [];
  private rawHead = 0;
  private compressedBuffer: ICompressedDataPoint[] = [];
  private compressedHead = 0;
  private compressionQueue: ITrafficDataPoint[] = [];

  constructor(private config: ISamplingConfig) {}

  addDataPoint(point: ITrafficDataPoint) {
    this.rawBuffer.push(point);

    const rawCutoff = Date.now() - this.config.rawDataMinutes * 60 * 1000;
    // O(1) amortized trimming using moving head; compact occasionally
    while (
      this.rawHead < this.rawBuffer.length &&
      this.rawBuffer[this.rawHead]?.timestamp <= rawCutoff
    ) {
      this.rawHead++;
    }
    if (this.rawHead > 512 && this.rawHead > this.rawBuffer.length / 2) {
      this.rawBuffer = this.rawBuffer.slice(this.rawHead);
      this.rawHead = 0;
    }

    this.compressionQueue.push(point);
    if (this.compressionQueue.length >= this.config.compressionRatio) {
      this.compressData();
    }

    const compressedCutoff =
      Date.now() - this.config.compressedDataMinutes * 60 * 1000;
    while (
      this.compressedHead < this.compressedBuffer.length &&
      this.compressedBuffer[this.compressedHead]?.timestamp <= compressedCutoff
    ) {
      this.compressedHead++;
    }
    if (
      this.compressedHead > 256 &&
      this.compressedHead > this.compressedBuffer.length / 2
    ) {
      this.compressedBuffer = this.compressedBuffer.slice(this.compressedHead);
      this.compressedHead = 0;
    }
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

    let rawStart = this.rawHead;
    while (
      rawStart < this.rawBuffer.length &&
      this.rawBuffer[rawStart]?.timestamp <= cutoff
    ) {
      rawStart++;
    }
    const rawData = this.rawBuffer.slice(rawStart);

    if (minutes <= this.config.rawDataMinutes) {
      return rawData;
    }

    const compressedCutoffUpper =
      Date.now() - this.config.rawDataMinutes * 60 * 1000;

    let compressedStart = this.compressedHead;
    while (
      compressedStart < this.compressedBuffer.length &&
      this.compressedBuffer[compressedStart]?.timestamp <= cutoff
    ) {
      compressedStart++;
    }

    const compressedData = this.compressedBuffer
      .slice(compressedStart)
      .filter((p) => p.timestamp <= compressedCutoffUpper)
      .map((p) => ({
        up: p.up,
        down: p.down,
        timestamp: p.timestamp,
        name: formatTrafficName(p.timestamp),
      }));

    return [...compressedData, ...rawData].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
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
    };
  }

  clear() {
    this.rawBuffer = [];
    this.rawHead = 0;
    this.compressedBuffer = [];
    this.compressedHead = 0;
    this.compressionQueue = [];
  }
}
