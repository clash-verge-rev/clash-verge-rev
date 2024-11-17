import useSWRSubscription from "swr/subscription";
import { useEnableLog } from "../services/states";
import { createSockette } from "../utils/websocket";
import { useClashInfo } from "./use-clash";
import dayjs from "dayjs";

const MAX_LOG_NUM = 1000;

// 添加 LogLevel 类型定义
export type LogLevel = "warning" | "info" | "debug" | "error";

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

export const useLogData = (logLevel: LogLevel) => {
  const { clashInfo } = useClashInfo();

  const [enableLog] = useEnableLog();

  return useSWRSubscription<ILogItem[], any, [string, LogLevel] | null>(
    enableLog && clashInfo ? ["getClashLog", logLevel] : null,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      const s = createSockette(buildWSUrl(server, secret, logLevel), {
        onmessage(event) {
          const data = JSON.parse(event.data) as ILogItem;

          // append new log item on socket message
          next(null, (l = []) => {
            const time = dayjs().format("MM-DD HH:mm:ss");

            if (l.length >= MAX_LOG_NUM) l.shift();
            return [...l, { ...data, time }];
          });
        },
        onerror(event) {
          this.close();
          next(event);
        },
      });

      return () => {
        s.close();
      };
    },
    {
      fallbackData: [],
      keepPreviousData: true,
    }
  );
};
