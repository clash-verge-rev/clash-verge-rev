import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { useClashInfo } from "@/hooks/use-clash";
import { useVisibility } from "@/hooks/use-visibility";
import { getSystemMonitorOverview } from "@/services/cmds";

// 流量数据项接口
export interface ITrafficDataPoint {
  up: number;
  down: number;
  timestamp: number;
  name: string;
}

// 流量监控数据接口
export interface ITrafficMonitorData {
  traffic: {
    raw: { up_rate: number; down_rate: number };
    formatted: { up_rate: string; down_rate: string };
    is_fresh: boolean;
  };
  memory: {
    raw: { inuse: number; oslimit?: number };
    formatted: { inuse: string; usage_percent?: number };
    is_fresh: boolean;
  };
}

// 图表数据管理接口
export interface ITrafficGraphData {
  dataPoints: ITrafficDataPoint[];
  addDataPoint: (data: {
    up: number;
    down: number;
    timestamp?: number;
  }) => void;
  clearData: () => void;
  getDataForTimeRange: (minutes: number) => ITrafficDataPoint[];
}

/**
 * 全局流量监控数据管理Hook
 * 提供统一的流量数据获取和图表数据管理
 */
export const useTrafficMonitor = () => {
  const { clashInfo } = useClashInfo();
  const pageVisible = useVisibility();

  // 图表数据缓冲区 - 使用ref保持数据持久性
  const dataBufferRef = useRef<ITrafficDataPoint[]>([]);
  const [, forceUpdate] = useState({});

  // 强制组件更新的函数
  const triggerUpdate = useCallback(() => {
    forceUpdate({});
  }, []);

  // 最大缓冲区大小 (10分钟 * 60秒 = 600个数据点)
  const MAX_BUFFER_SIZE = 600;

  // 初始化数据缓冲区
  useEffect(() => {
    if (dataBufferRef.current.length === 0) {
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;

      const initialBuffer = Array.from(
        { length: MAX_BUFFER_SIZE },
        (_, index) => {
          const pointTime =
            tenMinutesAgo + index * ((10 * 60 * 1000) / MAX_BUFFER_SIZE);
          const date = new Date(pointTime);

          let nameValue: string;
          try {
            if (isNaN(date.getTime())) {
              nameValue = "??:??:??";
            } else {
              nameValue = date.toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
            }
          } catch (e) {
            nameValue = "Err:Time";
          }

          return {
            up: 0,
            down: 0,
            timestamp: pointTime,
            name: nameValue,
          };
        },
      );

      dataBufferRef.current = initialBuffer;
    }
  }, [MAX_BUFFER_SIZE]);

  // 使用SWR获取监控数据
  const { data: monitorData, error } = useSWR<ISystemMonitorOverview>(
    clashInfo && pageVisible ? "getSystemMonitorOverview" : null,
    getSystemMonitorOverview,
    {
      refreshInterval: 1000, // 1秒刷新一次
      keepPreviousData: true,
      onSuccess: (data) => {
        console.log("[TrafficMonitor] 获取到监控数据:", data);

        if (data?.traffic) {
          // 为图表添加新数据点
          addDataPoint({
            up: data.traffic.raw.up_rate || 0,
            down: data.traffic.raw.down_rate || 0,
            timestamp: Date.now(),
          });
        }
      },
      onError: (error) => {
        console.error("[TrafficMonitor] 获取数据错误:", error);
      },
    },
  );

  // 添加数据点到缓冲区
  const addDataPoint = useCallback(
    (data: { up: number; down: number; timestamp?: number }) => {
      const timestamp = data.timestamp || Date.now();
      const date = new Date(timestamp);

      let nameValue: string;
      try {
        if (isNaN(date.getTime())) {
          nameValue = "??:??:??";
        } else {
          nameValue = date.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        }
      } catch (e) {
        nameValue = "Err:Time";
      }

      const newPoint: ITrafficDataPoint = {
        up: typeof data.up === "number" && !isNaN(data.up) ? data.up : 0,
        down:
          typeof data.down === "number" && !isNaN(data.down) ? data.down : 0,
        timestamp,
        name: nameValue,
      };

      // 更新缓冲区，保持固定大小
      const newBuffer = [...dataBufferRef.current.slice(1), newPoint];
      dataBufferRef.current = newBuffer;

      // 触发使用该数据的组件更新
      triggerUpdate();
    },
    [triggerUpdate],
  );

  // 清空数据
  const clearData = useCallback(() => {
    dataBufferRef.current = [];
    triggerUpdate();
  }, [triggerUpdate]);

  // 根据时间范围获取数据
  const getDataForTimeRange = useCallback(
    (minutes: number): ITrafficDataPoint[] => {
      const pointsToShow = minutes * 60; // 每分钟60个数据点
      return dataBufferRef.current.slice(-pointsToShow);
    },
    [],
  );

  // 构建图表数据管理对象
  const graphData: ITrafficGraphData = {
    dataPoints: dataBufferRef.current,
    addDataPoint,
    clearData,
    getDataForTimeRange,
  };

  // 构建监控数据对象
  const trafficMonitorData: ITrafficMonitorData = {
    traffic: monitorData?.traffic || {
      raw: { up_rate: 0, down_rate: 0 },
      formatted: { up_rate: "0B", down_rate: "0B" },
      is_fresh: false,
    },
    memory: monitorData?.memory || {
      raw: { inuse: 0 },
      formatted: { inuse: "0B" },
      is_fresh: false,
    },
  };

  return {
    // 原始监控数据
    monitorData: trafficMonitorData,
    // 图表数据管理
    graphData,
    // 数据获取状态
    isLoading: !monitorData && !error,
    error,
    // 数据新鲜度
    isDataFresh: monitorData?.overall_status === "active",
  };
};

/**
 * 仅获取流量数据的轻量级Hook
 * 适用于不需要图表数据的组件
 */
export const useTrafficData = () => {
  const { monitorData, isLoading, error, isDataFresh } = useTrafficMonitor();

  return {
    traffic: monitorData.traffic,
    memory: monitorData.memory,
    isLoading,
    error,
    isDataFresh,
  };
};

/**
 * 仅获取图表数据的Hook
 * 适用于图表组件
 */
export const useTrafficGraphData = () => {
  const { graphData, isDataFresh } = useTrafficMonitor();

  return {
    ...graphData,
    isDataFresh,
  };
};
