// 全局日志服务，使应用在任何页面都能收集日志
import { create } from "zustand";
import { createSockette } from "../utils/websocket";
import dayjs from "dayjs";
import { useState, useEffect } from "react";

// 最大日志数量
const MAX_LOG_NUM = 1000;

export type LogLevel = "warning" | "info" | "debug" | "error" | "all";

export interface ILogItem {
  time?: string;
  type: string;
  payload: string;
  [key: string]: any;
}

interface GlobalLogStore {
  logs: ILogItem[];
  enabled: boolean;
  isConnected: boolean;
  currentLevel: LogLevel;
  setEnabled: (enabled: boolean) => void;
  setCurrentLevel: (level: LogLevel) => void;
  clearLogs: () => void;
  appendLog: (log: ILogItem) => void;
}

// 创建全局状态存储
export const useGlobalLogStore = create<GlobalLogStore>((set) => ({
  logs: [],
  enabled: false,
  isConnected: false,
  currentLevel: "info",
  setEnabled: (enabled) => set({ enabled }),
  setCurrentLevel: (currentLevel) => set({ currentLevel }),
  clearLogs: () => set({ logs: [] }),
  appendLog: (log: ILogItem) =>
    set((state) => {
      const newLogs =
        state.logs.length >= MAX_LOG_NUM
          ? [...state.logs.slice(1), log]
          : [...state.logs, log];
      return { logs: newLogs };
    }),
}));

// 构建WebSocket URL
const buildWSUrl = (server: string, secret: string, logLevel: LogLevel) => {
  const baseUrl = `ws://${server}/logs`;
  const params = new URLSearchParams();

  if (secret) {
    params.append("token", secret);
  }
  if (logLevel === "all") {
    params.append("level", "debug");
  } else {
    params.append("level", logLevel);
  }
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

// 初始化全局日志服务
let globalLogSocket: any = null;

export const initGlobalLogService = (
  server: string,
  secret: string,
  enabled: boolean = false,
  logLevel: LogLevel = "info",
) => {
  const { appendLog, setEnabled } = useGlobalLogStore.getState();

  // 更新启用状态
  setEnabled(enabled);

  // 如果不启用或没有服务器信息，则不初始化
  if (!enabled || !server) {
    closeGlobalLogConnection();
    return;
  }

  // 关闭现有连接
  closeGlobalLogConnection();

  // 创建新的WebSocket连接
  const wsUrl = buildWSUrl(server, secret, logLevel);
  globalLogSocket = createSockette(wsUrl, {
    onmessage(event) {
      try {
        const data = JSON.parse(event.data) as ILogItem;
        const time = dayjs().format("MM-DD HH:mm:ss");
        appendLog({ ...data, time });
      } catch (error) {
        console.error("Failed to parse log data:", error);
      }
    },
    onerror() {
      console.error("Log WebSocket connection error");
      closeGlobalLogConnection();
    },
    onclose() {
      console.log("Log WebSocket connection closed");
      useGlobalLogStore.setState({ isConnected: false });
    },
    onopen() {
      console.log("Log WebSocket connection opened");
      useGlobalLogStore.setState({ isConnected: true });
    },
  });
};

// 关闭全局日志连接
export const closeGlobalLogConnection = () => {
  if (globalLogSocket) {
    globalLogSocket.close();
    globalLogSocket = null;
    useGlobalLogStore.setState({ isConnected: false });
  }
};

// 切换日志级别
export const changeLogLevel = (
  level: LogLevel,
  server: string,
  secret: string,
) => {
  const { enabled } = useGlobalLogStore.getState();
  useGlobalLogStore.setState({ currentLevel: level });

  if (enabled && server) {
    initGlobalLogService(server, secret, enabled, level);
  }
};

// 切换启用状态
export const toggleLogEnabled = (server: string, secret: string) => {
  const { enabled, currentLevel } = useGlobalLogStore.getState();
  const newEnabled = !enabled;

  useGlobalLogStore.setState({ enabled: newEnabled });

  if (newEnabled && server) {
    initGlobalLogService(server, secret, newEnabled, currentLevel);
  } else {
    closeGlobalLogConnection();
  }
};

// 获取日志清理函数
export const clearGlobalLogs = () => {
  useGlobalLogStore.getState().clearLogs();
};

// 自定义钩子，用于获取过滤后的日志数据
export const useGlobalLogData = (logLevel: LogLevel = "all") => {
  const logs = useGlobalLogStore((state) => state.logs);

  // 根据当前选择的日志等级过滤日志
  if (logLevel === "all") {
    return logs;
  } else {
    return logs.filter((log) => log.type.toLowerCase() === logLevel);
  }
};
