import { useEffect } from "react";
import { useEnableLog } from "../services/states";
import { createSockette } from "../utils/websocket";
import { useClashInfo } from "./use-clash";
import dayjs from "dayjs";
import { create } from "zustand";
import { useVisibility } from "./use-visibility";

const MAX_LOG_NUM = 1000;

export type LogLevel = "warning" | "info" | "debug" | "error" | "all";

interface ILogItem {
  time?: string;
  type: string;
  payload: string;
  [key: string]: any;
}

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

interface LogStore {
  logs: ILogItem[];
  clearLogs: () => void;
  appendLog: (log: ILogItem) => void;
}

const useLogStore = create<LogStore>(
  (set: (fn: (state: LogStore) => Partial<LogStore>) => void) => ({
    logs: [],
    clearLogs: () =>
      set(() => ({
        logs: [],
      })),
    appendLog: (log: ILogItem) =>
      set((state: LogStore) => {
        const newLogs =
          state.logs.length >= MAX_LOG_NUM
            ? [...state.logs.slice(1), log]
            : [...state.logs, log];
        return { logs: newLogs };
      }),
  }),
);

export const useLogData = (logLevel: LogLevel) => {
  const { clashInfo } = useClashInfo();
  const [enableLog] = useEnableLog();
  const { logs, appendLog } = useLogStore();
  const pageVisible = useVisibility();

  useEffect(() => {
    if (!enableLog || !clashInfo || !pageVisible) return;

    const { server = "", secret = "" } = clashInfo;
    const wsUrl = buildWSUrl(server, secret, logLevel);

    let isActive = true;
    const socket = createSockette(wsUrl, {
      onmessage(event) {
        if (!isActive) return;
        const data = JSON.parse(event.data) as ILogItem;
        const time = dayjs().format("MM-DD HH:mm:ss");
        appendLog({ ...data, time });
      },
      onerror() {
        if (!isActive) return;
        socket.close();
      },
    });

    return () => {
      isActive = false;
      socket.close();
    };
  }, [clashInfo, enableLog, logLevel]);

  // 根据当前选择的日志等级过滤日志
  return logLevel === "all"
    ? logs
    : logs.filter((log) => log.type.toLowerCase() === logLevel);
};

// 导出清空日志的方法
export const clearLogs = () => {
  useLogStore.getState().clearLogs();
};
