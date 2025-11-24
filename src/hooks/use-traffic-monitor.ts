import { useEffect, useRef, useCallback, useReducer } from "react";
import { Traffic } from "tauri-plugin-mihomo-api";

import { debugLog } from "@/utils/debug";

// 增强的流量数据点接口
export interface ITrafficDataPoint {
  up: number;
  down: number;
  timestamp: number;
  name: string;
}

// 压缩的数据点（用于长期存储）
interface ICompressedDataPoint {
  up: number;
  down: number;
  timestamp: number;
  samples: number; // 压缩了多少个原始数据点
}

// 数据采样器配置
interface ISamplingConfig {
  // 原始数据保持时间（分钟）
  rawDataMinutes: number;
  // 压缩数据保持时间（分钟）
  compressedDataMinutes: number;
  // 压缩比例（多少个原始点压缩成1个）
  compressionRatio: number;
}

// 引用计数管理器
class ReferenceCounter {
  private count = 0;
  private callbacks: (() => void)[] = [];

  increment(): () => void {
    this.count++;
    debugLog(`[ReferenceCounter] 引用计数增加: ${this.count}`);

    if (this.count === 1) {
      // 从0到1，开始数据收集
      this.callbacks.forEach((cb) => cb());
    }

    return () => {
      this.count--;
      debugLog(`[ReferenceCounter] 引用计数减少: ${this.count}`);

      if (this.count === 0) {
        // 从1到0，停止数据收集
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

// 智能数据采样器
class TrafficDataSampler {
  private rawBuffer: ITrafficDataPoint[] = [];
  private compressedBuffer: ICompressedDataPoint[] = [];
  private config: ISamplingConfig;
  private compressionQueue: ITrafficDataPoint[] = [];

  constructor(config: ISamplingConfig) {
    this.config = config;
  }

  addDataPoint(point: ITrafficDataPoint): void {
    // 添加到原始缓冲区
    this.rawBuffer.push(point);

    // 清理过期的原始数据
    const rawCutoff = Date.now() - this.config.rawDataMinutes * 60 * 1000;
    this.rawBuffer = this.rawBuffer.filter((p) => p.timestamp > rawCutoff);

    // 添加到压缩队列
    this.compressionQueue.push(point);

    // 当压缩队列达到压缩比例时，执行压缩
    if (this.compressionQueue.length >= this.config.compressionRatio) {
      this.compressData();
    }

    // 清理过期的压缩数据
    const compressedCutoff =
      Date.now() - this.config.compressedDataMinutes * 60 * 1000;
    this.compressedBuffer = this.compressedBuffer.filter(
      (p) => p.timestamp > compressedCutoff,
    );
  }

  private compressData(): void {
    if (this.compressionQueue.length === 0) return;

    // 计算平均值进行压缩
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

    debugLog(`[DataSampler] 压缩了 ${compressedPoint.samples} 个数据点`);
  }

  getDataForTimeRange(minutes: number): ITrafficDataPoint[] {
    const cutoff = Date.now() - minutes * 60 * 1000;

    // 如果请求的时间范围在原始数据范围内，直接返回原始数据
    if (minutes <= this.config.rawDataMinutes) {
      return this.rawBuffer.filter((p) => p.timestamp > cutoff);
    }

    // 否则组合原始数据和压缩数据
    const rawData = this.rawBuffer.filter((p) => p.timestamp > cutoff);
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
        name: new Date(p.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
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

  clear(): void {
    this.rawBuffer = [];
    this.compressedBuffer = [];
    this.compressionQueue = [];
  }
}

// 全局单例
const refCounter = new ReferenceCounter();
let globalSampler: TrafficDataSampler | null = null;

/**
 * 增强的流量监控Hook - 支持数据压缩、采样和引用计数
 */
export const useTrafficMonitorEnhanced = () => {
  // 初始化采样器
  if (!globalSampler) {
    globalSampler = new TrafficDataSampler({
      rawDataMinutes: 10, // 原始数据保持10分钟
      compressedDataMinutes: 60, // 压缩数据保持1小时
      compressionRatio: 5, // 每5个原始点压缩成1个
    });
  }

  const [, forceRender] = useReducer((version: number) => version + 1, 0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const bumpRenderVersion = useCallback(() => {
    forceRender();
  }, []);

  // 注册引用计数
  useEffect(() => {
    debugLog("[TrafficMonitorEnhanced] 组件挂载，注册引用计数");
    const cleanup = refCounter.increment();
    cleanupRef.current = cleanup;

    return () => {
      debugLog("[TrafficMonitorEnhanced] 组件卸载，清理引用计数");
      cleanup();
      cleanupRef.current = null;
    };
  }, []);

  // 设置引用计数变化回调
  useEffect(() => {
    const handleCountChange = () => {
      debugLog(
        `[TrafficMonitorEnhanced] 引用计数变化: ${refCounter.getCount()}`,
      );
      if (refCounter.getCount() === 0) {
        debugLog("[TrafficMonitorEnhanced] 所有组件已卸载，暂停数据收集");
      } else {
        debugLog("[TrafficMonitorEnhanced] 开始数据收集");
      }
    };

    refCounter.onCountChange(handleCountChange);
  }, []);

  // 获取指定时间范围的数据
  const getDataForTimeRange = useCallback(
    (minutes: number): ITrafficDataPoint[] => {
      if (!globalSampler) return [];
      return globalSampler.getDataForTimeRange(minutes);
    },
    [],
  );

  // 添加流量数据
  const appendData = useCallback((traffic: Traffic) => {
    if (globalSampler) {
      // 添加到采样器
      const timestamp = Date.now();
      const dataPoint: ITrafficDataPoint = {
        up: traffic?.up || 0,
        down: traffic?.down || 0,
        timestamp,
        name: new Date(timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      globalSampler.addDataPoint(dataPoint);
    }
  }, []);

  // 清空数据
  const clearData = useCallback(() => {
    if (globalSampler) {
      globalSampler.clear();
      bumpRenderVersion();
    }
  }, [bumpRenderVersion]);

  // 获取采样器统计信息
  const getSamplerStats = useCallback(() => {
    return (
      globalSampler?.getStats() || {
        rawBufferSize: 0,
        compressedBufferSize: 0,
        compressionQueueSize: 0,
        totalMemoryPoints: 0,
      }
    );
  }, []);

  return {
    // 图表数据管理
    graphData: {
      dataPoints: globalSampler?.getDataForTimeRange(60) || [], // 默认获取1小时数据
      getDataForTimeRange,
      appendData,
      clearData,
    },
    // 性能统计
    samplerStats: getSamplerStats(),
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
