import { getClashLogs } from "@/services/cmds";
import { listen } from "@tauri-apps/api/event";
import dayjs from "dayjs";
import { useLocalStorage } from "foxact/use-local-storage";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";
import { useClashLog } from "../services/states";

const MAX_LOG_NUM = 1000;

export const useLogData = () => {
  const [clashLog] = useClashLog();
  const enableLog = clashLog.enable;
  const logLevel = clashLog.logLevel;

  const [date, setDate] = useLocalStorage("mihomo_logs_date", Date.now());
  const subscriptKey = enableLog ? `getClashLog-${date}-${logLevel}` : null;

  const ws = useRef<MihomoWebSocket | null>(null);
  const ws_first_connection = useRef<boolean>(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const response = useSWRSubscription<ILogItem[], any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      // populate the initial logs

      const connect = () =>
        MihomoWebSocket.connect_logs(logLevel)
          .then((ws_) => {
            ws.current = ws_;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            getClashLogs().then(
              (logs) => next(null, logs),
              (err) => next(err),
            );
            ws_.addListener(async (msg) => {
              if (msg.type === "Text") {
                if (msg.data.startsWith("websocket error")) {
                  next(msg.data);
                  await ws.current?.close();
                  ws.current = null;
                  timeoutRef.current = setTimeout(() => connect(), 500);
                } else {
                  const data = JSON.parse(msg.data) as ILogItem;
                  // append new log item on socket message
                  next(null, (l = []) => {
                    const time = dayjs().format("MM-DD HH:mm:ss");
                    if (l.length >= MAX_LOG_NUM) l.shift();
                    const newList = [...l, { ...data, time }];
                    return newList;
                  });
                }
              }
            });
          })
          .catch((_) => {
            if (!ws.current) {
              timeoutRef.current = setTimeout(() => connect(), 500);
            }
          });

      if (
        ws_first_connection.current ||
        (ws.current && !ws_first_connection.current)
      ) {
        ws_first_connection.current = false;
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
    const unlistenRefreshWebsocket = listen(
      "verge://refresh-websocket",
      async () => {
        ws.current?.close();
        setDate(Date.now());
      },
    );

    return () => {
      unlistenRefreshWebsocket.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    mutate(`$sub$${subscriptKey}`);
  }, [date]);

  const refreshGetClashLog = (clear = false) => {
    if (clear) {
      mutate(`$sub$${subscriptKey}`, []);
    } else {
      setDate(Date.now());
    }
  };

  return { response, refreshGetClashLog };
};
