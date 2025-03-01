import { useEffect } from "react";
import { useEnableLog } from "../services/states";
import { createSockette } from "../utils/websocket";
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

export const useLogData = useGlobalLogData;

export const clearLogs = clearGlobalLogs;
