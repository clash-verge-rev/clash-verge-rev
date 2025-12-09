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
        name: formatTrafficName(p.timestamp),
      }));

    return [...compressedData, ...rawData].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  getStats(): ISamplerStats {
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
