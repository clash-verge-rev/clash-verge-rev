import useSWRSubscription from "swr/subscription";
import { useEnableLog } from "../services/states";
import { createSockette } from "../utils/websocket";
import { useClashInfo } from "./use-clash";
import dayjs from "dayjs";
import { create } from "zustand";

const MAX_LOG_NUM = 1000;

export type LogLevel = "warning" | "info" | "debug" | "error";

// 添加 ILogItem 接口定义
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
    params.append("token", encodeURIComponent(secret));
  }
  params.append("level", logLevel);
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

interface LogStore {
  logs: Record<LogLevel, ILogItem[]>;
  clearLogs: (level?: LogLevel) => void;
  appendLog: (level: LogLevel, log: ILogItem) => void;
}

const useLogStore = create<LogStore>(
  (set: (fn: (state: LogStore) => Partial<LogStore>) => void) => ({
    logs: {
      warning: [],
      info: [],
      debug: [],
      error: [],
    },
    clearLogs: (level?: LogLevel) =>
      set((state: LogStore) => ({
        logs: level
          ? { ...state.logs, [level]: [] }
          : { warning: [], info: [], debug: [], error: [] },
      })),
    appendLog: (level: LogLevel, log: ILogItem) =>
      set((state: LogStore) => {
        const currentLogs = state.logs[level];
        const newLogs =
          currentLogs.length >= MAX_LOG_NUM
            ? [...currentLogs.slice(1), log]
            : [...currentLogs, log];
        return { logs: { ...state.logs, [level]: newLogs } };
      }),
  })
);

export const useLogData = (logLevel: LogLevel) => {
  const { clashInfo } = useClashInfo();
  const [enableLog] = useEnableLog();
  const { logs, appendLog } = useLogStore();

  useSWRSubscription<ILogItem[], any, [string, LogLevel] | null>(
    enableLog && clashInfo ? ["getClashLog", logLevel] : null,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      const s = createSockette(buildWSUrl(server, secret, logLevel), {
        onmessage(event) {
          const data = JSON.parse(event.data) as ILogItem;
          const time = dayjs().format("MM-DD HH:mm:ss");
          appendLog(logLevel, { ...data, time });
        },
        onerror(event) {
          this.close();
          next(event);
        },
      });

      return () => {
        s.close();
      };
    }
  );

  return logs[logLevel];
};

// 导出清空日志的方法
export const clearLogs = (level?: LogLevel) => {
  useLogStore.getState().clearLogs(level);
};
