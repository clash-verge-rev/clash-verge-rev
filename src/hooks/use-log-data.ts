import { useEffect } from "react";
import { useEnableLog } from "../services/states";
import { createSockette, createAuthSockette } from "../utils/websocket";
import { useClashInfo } from "./use-clash";
import dayjs from "dayjs";
import { create } from "zustand";
import { useVisibility } from "./use-visibility";
import {
  useGlobalLogData,
  clearGlobalLogs,
  LogLevel,
  ILogItem,
} from "@/services/global-log-service";

// 为了向后兼容，导出相同的类型
export type { LogLevel };
export type { ILogItem };

const MAX_LOG_NUM = 1000;

const buildWSUrl = (server: string, logLevel: LogLevel) => {
  let baseUrl = `${server}/logs`;

  // 只处理日志级别参数
  if (logLevel && logLevel !== "info") {
    const level = logLevel === "all" ? "debug" : logLevel;
    baseUrl += `?level=${level}`;
  }

  return baseUrl;
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

export const useLogData = useGlobalLogData;

export const clearLogs = clearGlobalLogs;
