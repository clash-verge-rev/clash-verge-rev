import dayjs from "dayjs";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import { MihomoWebSocket, type LogLevel } from "tauri-plugin-mihomo-api";

import { getClashLogs } from "@/services/cmds";

import { useClashLog } from "./use-clash-log";
import { useMihomoWsSubscription } from "./use-mihomo-ws-subscription";

const MAX_LOG_NUM = 1000;
const FLUSH_DELAY_MS = 50;
type LogType = ILogItem["type"];

const DEFAULT_LOG_TYPES: LogType[] = ["debug", "info", "warning", "error"];
const LOG_LEVEL_FILTERS: Record<LogLevel, LogType[]> = {
  debug: DEFAULT_LOG_TYPES,
  info: ["info", "warning", "error"],
  warning: ["warning", "error"],
  error: ["error"],
  silent: [],
};

const clampLogs = (logs: ILogItem[]): ILogItem[] =>
  logs.length > MAX_LOG_NUM ? logs.slice(-MAX_LOG_NUM) : logs;

const filterLogsByLevel = (
  logs: ILogItem[],
  allowedTypes: LogType[],
): ILogItem[] => {
  if (allowedTypes.length === 0) return [];
  if (allowedTypes.length === DEFAULT_LOG_TYPES.length) return logs;
  return logs.filter((log) => allowedTypes.includes(log.type));
};

const appendLogs = (
  current: ILogItem[] | undefined,
  incoming: ILogItem[],
): ILogItem[] => clampLogs([...(current ?? []), ...incoming]);

export const useLogData = () => {
  const [clashLog] = useClashLog();
  const enableLog = clashLog.enable;
  const logLevel = clashLog.logLevel;
  const allowedTypes = LOG_LEVEL_FILTERS[logLevel] ?? DEFAULT_LOG_TYPES;

  const { response, refresh, subscriptionCacheKey } = useMihomoWsSubscription<
    ILogItem[]
  >({
    storageKey: "mihomo_logs_date",
    buildSubscriptKey: (date) => (enableLog ? `getClashLog-${date}` : null),
    fallbackData: [],
    keepPreviousData: true,
    connect: () => MihomoWebSocket.connect_logs(logLevel),
    setupHandlers: ({ next, scheduleReconnect, isMounted }) => {
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const buffer: ILogItem[] = [];

      const clearFlushTimer = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
      };

      const flush = () => {
        if (!buffer.length || !isMounted()) {
          flushTimer = null;
          return;
        }
        const pendingLogs = buffer.splice(0, buffer.length);
        next(null, (current) => appendLogs(current, pendingLogs));
        flushTimer = null;
      };

      return {
        handleMessage: (data) => {
          if (data.startsWith("Websocket error")) {
            next(data);
            void scheduleReconnect();
            return;
          }

          try {
            const parsed = JSON.parse(data) as ILogItem;
            if (
              allowedTypes.length > 0 &&
              !allowedTypes.includes(parsed.type)
            ) {
              return;
            }
            parsed.time = dayjs().format("MM-DD HH:mm:ss");
            buffer.push(parsed);
            if (!flushTimer) {
              flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
            }
          } catch (error) {
            next(error);
          }
        },
        async onConnected() {
          const logs = await getClashLogs();
          if (isMounted()) {
            next(null, clampLogs(filterLogsByLevel(logs, allowedTypes)));
          }
        },
        cleanup: clearFlushTimer,
      };
    },
  });

  const previousLogLevel = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!logLevel) {
      previousLogLevel.current = logLevel ?? undefined;
      return;
    }

    if (previousLogLevel.current === logLevel) {
      return;
    }

    previousLogLevel.current = logLevel;
    refresh();
  }, [logLevel, refresh]);

  const refreshGetClashLog = (clear = false) => {
    if (clear) {
      if (subscriptionCacheKey) {
        mutate(subscriptionCacheKey, []);
      }
    } else {
      refresh();
    }
  };

  return { response, refreshGetClashLog };
};
