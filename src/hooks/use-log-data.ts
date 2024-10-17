import dayjs from "dayjs";
import { useMemo } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { getClashLogs } from "../services/cmds";
import { useClashLog } from "../services/states";
import { createSockette } from "../utils/websocket";
import { useClashInfo } from "./use-clash";

const MAX_LOG_NUM = 1000;

export const useLogData = () => {
  const { clashInfo } = useClashInfo();
  const [clashLog] = useClashLog();
  const enableLog = clashLog.enable;
  const logLevel = clashLog.logLevel;

  const subscriptClashLogKey = useMemo(() => {
    if (!enableLog || !clashInfo) return null;
    return `getClashLog-${clashInfo.server}-${clashInfo.secret}-${enableLog}-${logLevel}`;
  }, [clashInfo, enableLog, logLevel]);

  const response = useSWRSubscription<ILogItem[], any, string | null>(
    subscriptClashLogKey,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      // populate the initial logs
      getClashLogs().then(
        (logs) => next(null, logs),
        (err) => next(err),
      );

      const s = createSockette(
        `ws://${server}/logs?token=${encodeURIComponent(secret)}&level=${logLevel}`,
        {
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
        },
      );

      return () => {
        s.close();
      };
    },
    {
      fallbackData: [],
      keepPreviousData: true,
    },
  );

  const refreshGetClashLog = () => {
    mutate(`$sub$${subscriptClashLogKey}`, []);
  };

  return { response, refreshGetClashLog };
};
