// 全局日志服务，使应用在任何页面都能收集日志
import { create } from "zustand";
import {
  fetchLogsViaIPC,
  startLogsStreaming,
  stopLogsStreaming,
  clearLogs as clearLogsIPC,
} from "@/services/ipc-log-service";
import dayjs from "dayjs";

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
  setLogs: (logs: ILogItem[]) => void;
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
  setLogs: (logs: ILogItem[]) => set({ logs }),
}));

// IPC 日志获取函数
export const fetchLogsViaIPCPeriodically = async (
  logLevel: LogLevel = "info",
) => {
  try {
    const logs = await fetchLogsViaIPC(logLevel);
    useGlobalLogStore.getState().setLogs(logs);
    console.log(`[GlobalLog-IPC] 成功获取 ${logs.length} 条日志`);
  } catch (error) {
    console.error("[GlobalLog-IPC] 获取日志失败:", error);
  }
};

// 初始化全局日志服务 (仅IPC模式)
let ipcPollingInterval: number | null = null;
let isInitializing = false; // 添加初始化标志

export const initGlobalLogService = (
  enabled: boolean = false,
  logLevel: LogLevel = "info",
) => {
  // 防止重复初始化
  if (isInitializing) {
    console.log("[GlobalLog-IPC] 正在初始化中，跳过重复调用");
    return;
  }

  const { setEnabled, setCurrentLevel } = useGlobalLogStore.getState();

  // 更新启用状态
  setEnabled(enabled);
  setCurrentLevel(logLevel);

  // 如果不启用，则不初始化
  if (!enabled) {
    clearIpcPolling();
    useGlobalLogStore.setState({ isConnected: false });
    return;
  }

  isInitializing = true;

  // 使用IPC流式模式
  console.log("[GlobalLog-IPC] 启用IPC流式日志服务");

  // 启动流式监控
  startLogsStreaming(logLevel);

  // 立即获取一次日志
  fetchLogsViaIPCPeriodically(logLevel);

  // 设置定期轮询来同步流式缓存的数据
  clearIpcPolling();
  ipcPollingInterval = setInterval(() => {
    fetchLogsViaIPCPeriodically(logLevel);
  }, 1000); // 每1秒同步一次流式缓存

  // 设置连接状态
  useGlobalLogStore.setState({ isConnected: true });

  isInitializing = false;
};

// 清除IPC轮询
const clearIpcPolling = () => {
  if (ipcPollingInterval) {
    clearInterval(ipcPollingInterval);
    ipcPollingInterval = null;
    console.log("[GlobalLog-IPC] 轮询已停止");
  }
};

// 停止日志监控 (仅IPC模式)
export const stopGlobalLogMonitoring = async () => {
  clearIpcPolling();
  isInitializing = false; // 重置初始化标志

  // 调用后端停止监控
  await stopLogsStreaming();

  useGlobalLogStore.setState({ isConnected: false });
  console.log("[GlobalLog-IPC] 日志监控已停止");
};

// 关闭全局日志连接 (仅IPC模式) - 保持向后兼容
export const closeGlobalLogConnection = async () => {
  await stopGlobalLogMonitoring();
};

// 切换日志级别 (仅IPC模式)
export const changeLogLevel = (level: LogLevel) => {
  const { enabled } = useGlobalLogStore.getState();
  useGlobalLogStore.setState({ currentLevel: level });

  // 如果正在初始化，则跳过，避免重复启动
  if (isInitializing) {
    console.log("[GlobalLog-IPC] 正在初始化中，跳过级别变更流启动");
    return;
  }

  if (enabled) {
    // IPC流式模式下重新启动监控
    startLogsStreaming(level);
    fetchLogsViaIPCPeriodically(level);
  }
};

// 切换启用状态 (仅IPC模式)
export const toggleLogEnabled = async () => {
  const { enabled, currentLevel } = useGlobalLogStore.getState();
  const newEnabled = !enabled;

  useGlobalLogStore.setState({ enabled: newEnabled });

  if (newEnabled) {
    // IPC模式下直接启动
    initGlobalLogService(newEnabled, currentLevel);
  } else {
    await stopGlobalLogMonitoring();
  }
};

// 获取日志清理函数 - 只清理前端日志，不停止监控
export const clearGlobalLogs = () => {
  useGlobalLogStore.getState().clearLogs();
  // 同时清理后端缓存的日志，但不停止监控
  clearLogsIPC();
};

// 自定义钩子，用于获取过滤后的日志数据
export const useGlobalLogData = (logLevel: LogLevel = "all") => {
  const logs = useGlobalLogStore((state) => state.logs);

  // 日志已经在后端根据级别进行了过滤，这里直接返回所有日志
  // 不需要在前端再次过滤，避免重复过滤导致DEBUG日志丢失
  return logs;
};
