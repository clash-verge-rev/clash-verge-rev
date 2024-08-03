import useSWRSubscription from "swr/subscription";
import { useEnableLog } from "../services/states";
import { createSockette } from "../utils/websocket";
import { useClashInfo } from "./use-clash";
import dayjs from "dayjs";
import { getClashLogs } from "../services/cmds";

const MAX_LOG_NUM = 1000;

export const useLogData = () => {
  const { clashInfo } = useClashInfo();

  const [enableLog] = useEnableLog();
  !enableLog || !clashInfo;

  return useSWRSubscription<ILogItem[], any, "getClashLog" | null>(
    enableLog && clashInfo ? "getClashLog" : null,
    (_key, { next }) => {
      const { server = "", secret = "" } = clashInfo!;

      // populate the initial logs
      getClashLogs().then(
        (logs) => next(null, logs),
        (err) => next(err)
      );

      const s = createSockette(
        `ws://${server}/logs?token=${encodeURIComponent(secret)}`,
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
        }
      );

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
