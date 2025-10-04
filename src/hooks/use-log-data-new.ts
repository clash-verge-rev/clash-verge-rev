import dayjs from "dayjs";
import { useLocalStorage } from "foxact/use-local-storage";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

import { getClashLogs } from "@/services/cmds";
import { useClashLog } from "@/services/states";

const MAX_LOG_NUM = 1000;

export const useLogData = () => {
  const [clashLog] = useClashLog();
  const enableLog = clashLog.enable;
  const logLevel = clashLog.logLevel;

  const [date, setDate] = useLocalStorage("mihomo_logs_date", Date.now());
  const subscriptKey = enableLog ? `getClashLog-${date}` : null;

  const ws = useRef<MihomoWebSocket | null>(null);
  const wsFirstConnection = useRef<boolean>(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const response = useSWRSubscription<ILogItem[], any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      const reconnect = async () => {
        await ws.current?.close();
        ws.current = null;
        timeoutRef.current = setTimeout(async () => await connect(), 500);
      };

      const connect = () =>
        MihomoWebSocket.connect_logs(logLevel)
          .then(async (ws_) => {
            ws.current = ws_;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            const logs = await getClashLogs();
            let filterLogs: ILogItem[] = [];
            switch (logLevel) {
              case "debug":
                filterLogs = logs.filter((i) =>
                  ["debug", "info", "warning", "error"].includes(i.type),
                );
                break;
              case "info":
                filterLogs = logs.filter((i) =>
                  ["info", "warning", "error"].includes(i.type),
                );
                break;
              case "warning":
                filterLogs = logs.filter((i) =>
                  ["warning", "error"].includes(i.type),
                );
                break;
              case "error":
                filterLogs = logs.filter((i) => i.type === "error");
                break;
              case "silent":
                filterLogs = [];
                break;
              default:
                filterLogs = logs;
                break;
            }
            next(null, filterLogs);

            const buffer: ILogItem[] = [];
            let flushTimer: ReturnType<typeof setTimeout> | null = null;
            const flush = () => {
              if (buffer.length > 0) {
                next(null, (l) => {
                  let newList = [...(l ?? []), ...buffer.splice(0)];
                  if (newList.length > MAX_LOG_NUM) {
                    newList = newList.slice(
                      -Math.min(MAX_LOG_NUM, newList.length),
                    );
                  }
                  return newList;
                });
              }
              flushTimer = null;
            };
            ws_.addListener(async (msg) => {
              if (msg.type === "Text") {
                if (msg.data.startsWith("Websocket error")) {
                  next(msg.data);
                  await reconnect();
                } else {
                  const data = JSON.parse(msg.data) as ILogItem;
                  data.time = dayjs().format("MM-DD HH:mm:ss");
                  buffer.push(data);

                  // flush data
                  if (!flushTimer) {
                    flushTimer = setTimeout(flush, 50);
                  }
                }
              }
            });
          })
          .catch((_) => {
            if (!ws.current) {
              timeoutRef.current = setTimeout(async () => await connect(), 500);
            }
          });

      if (
        wsFirstConnection.current ||
        (ws.current && !wsFirstConnection.current)
      ) {
        wsFirstConnection.current = false;
        if (ws.current) {
          ws.current.close();
          ws.current = null;
        }
        connect();
      }

      return () => {
        ws.current?.close();
      };
    },
    {
      fallbackData: [],
      keepPreviousData: true,
    },
  );

  useEffect(() => {
    mutate(`$sub$${subscriptKey}`);
  }, [date, subscriptKey]);

  useEffect(() => {
    if (!logLevel) return;
    ws.current?.close();
    setDate(Date.now());
  }, [logLevel]);

  const refreshGetClashLog = (clear = false) => {
    if (clear) {
      mutate(`$sub$${subscriptKey}`, []);
    } else {
      setDate(Date.now());
    }
  };

  return { response, refreshGetClashLog };
};
