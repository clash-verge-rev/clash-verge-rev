import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { useClashInfo } from "@/hooks/use-clash";
import { useVisibility } from "@/hooks/use-visibility";
import { getSystemMonitorOverviewSafe } from "@/services/cmds";

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
    console.log(`[ReferenceCounter] 引用计数增加: ${this.count}`);

    if (this.count === 1) {
      // 从0到1，开始数据收集
      this.callbacks.forEach((cb) => cb());
    }

    return () => {
      this.count--;
      console.log(`[ReferenceCounter] 引用计数减少: ${this.count}`);

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

    console.log(`[DataSampler] 压缩了 ${compressedPoint.samples} 个数据点`);
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
let lastValidData: ISystemMonitorOverview | null = null;

/**
 * 增强的流量监控Hook - 支持数据压缩、采样和引用计数
 */
export const useTrafficMonitorEnhanced = () => {
  const { clashInfo } = useClashInfo();
  const pageVisible = useVisibility();

  // 初始化采样器
  if (!globalSampler) {
    globalSampler = new TrafficDataSampler({
      rawDataMinutes: 10, // 原始数据保持10分钟
      compressedDataMinutes: 60, // 压缩数据保持1小时
      compressionRatio: 5, // 每5个原始点压缩成1个
    });
  }

  const [, forceUpdate] = useState({});
  const cleanupRef = useRef<(() => void) | null>(null);

  // 强制组件更新
  const triggerUpdate = useCallback(() => {
    forceUpdate({});
  }, []);

  // 注册引用计数
  useEffect(() => {
    console.log("[TrafficMonitorEnhanced] 组件挂载，注册引用计数");
    const cleanup = refCounter.increment();
    cleanupRef.current = cleanup;

    return () => {
      console.log("[TrafficMonitorEnhanced] 组件卸载，清理引用计数");
      cleanup();
      cleanupRef.current = null;
    };
  }, []);

  // 设置引用计数变化回调
  useEffect(() => {
    const handleCountChange = () => {
      console.log(
        `[TrafficMonitorEnhanced] 引用计数变化: ${refCounter.getCount()}`,
      );
      if (refCounter.getCount() === 0) {
        console.log("[TrafficMonitorEnhanced] 所有组件已卸载，暂停数据收集");
      } else {
        console.log("[TrafficMonitorEnhanced] 开始数据收集");
      }
    };

    refCounter.onCountChange(handleCountChange);
  }, []);

  // 只有在有引用时才启用SWR
  const shouldFetch = clashInfo && pageVisible && refCounter.getCount() > 0;

  const { data: monitorData, error } = useSWR<ISystemMonitorOverview>(
    shouldFetch ? "getSystemMonitorOverviewSafe" : null,
    getSystemMonitorOverviewSafe,
    {
      refreshInterval: shouldFetch ? 1000 : 0, // 只有在需要时才刷新
      keepPreviousData: true,
      onSuccess: (data) => {
        // console.log("[TrafficMonitorEnhanced] 获取到监控数据:", data);

        if (data?.traffic?.raw && globalSampler) {
          // 保存最后有效数据
          lastValidData = data;

          // 添加到采样器
          const timestamp = Date.now();
          const dataPoint: ITrafficDataPoint = {
            up: data.traffic.raw.up_rate || 0,
            down: data.traffic.raw.down_rate || 0,
            timestamp,
            name: new Date(timestamp).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          };

          globalSampler.addDataPoint(dataPoint);
          triggerUpdate();
        }
      },
      onError: (error) => {
        console.error(
          "[TrafficMonitorEnhanced] 网络错误，使用最后有效数据. 错误详情:",
          {
            message: error?.message || "未知错误",
            stack: error?.stack || "无堆栈信息",
          },
        );
        // 网络错误时不清空数据，继续使用最后有效值
        // 但是添加一个错误标记的数据点（流量为0）
        if (globalSampler) {
          const timestamp = Date.now();
          const errorPoint: ITrafficDataPoint = {
            up: 0,
            down: 0,
            timestamp,
            name: new Date(timestamp).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          };
          globalSampler.addDataPoint(errorPoint);
          triggerUpdate();
        }
      },
    },
  );

  // 获取指定时间范围的数据
  const getDataForTimeRange = useCallback(
    (minutes: number): ITrafficDataPoint[] => {
      if (!globalSampler) return [];
      return globalSampler.getDataForTimeRange(minutes);
    },
    [],
  );

  // 清空数据
  const clearData = useCallback(() => {
    if (globalSampler) {
      globalSampler.clear();
      triggerUpdate();
    }
  }, [triggerUpdate]);

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

  // 构建返回的监控数据，优先使用当前数据，fallback到最后有效数据
  const currentData = monitorData || lastValidData;
  const trafficMonitorData = {
    traffic: currentData?.traffic || {
      raw: { up: 0, down: 0, up_rate: 0, down_rate: 0 },
      formatted: {
        up_rate: "0B",
        down_rate: "0B",
        total_up: "0B",
        total_down: "0B",
      },
      is_fresh: false,
    },
    memory: currentData?.memory || {
      raw: { inuse: 0, oslimit: 0, usage_percent: 0 },
      formatted: { inuse: "0B", oslimit: "0B", usage_percent: 0 },
      is_fresh: false,
    },
  };

  return {
    // 监控数据
    monitorData: trafficMonitorData,

    // 图表数据管理
    graphData: {
      dataPoints: globalSampler?.getDataForTimeRange(60) || [], // 默认获取1小时数据
      getDataForTimeRange,
      clearData,
    },

    // 状态信息
    isLoading: !currentData && !error,
    error,
    isDataFresh: currentData?.traffic?.is_fresh || false,
    hasValidData: !!lastValidData,

    // 性能统计
    samplerStats: getSamplerStats(),
    referenceCount: refCounter.getCount(),
  };
};

/**
 * 轻量级流量数据Hook
 */
export const useTrafficDataEnhanced = () => {
  const { monitorData, isLoading, error, isDataFresh, hasValidData } =
    useTrafficMonitorEnhanced();

  return {
    traffic: monitorData.traffic,
    memory: monitorData.memory,
    isLoading,
    error,
    isDataFresh,
    hasValidData,
  };
};

/**
 * 图表数据Hook
 */
export const useTrafficGraphDataEnhanced = () => {
  const { graphData, isDataFresh, samplerStats, referenceCount } =
    useTrafficMonitorEnhanced();

  return {
    ...graphData,
    isDataFresh,
    samplerStats,
    referenceCount,
  };
};
