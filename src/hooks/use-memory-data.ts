import { listen } from "@tauri-apps/api/event";
import { useLocalStorage } from "foxact/use-local-storage";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

export const useMemoryData = () => {
  const [date, setDate] = useLocalStorage("mihomo_memory_date", Date.now());
  const subscriptKey = `getClashMemory-${date}`;

  const ws = useRef<MihomoWebSocket | null>(null);
  const wsFirstConnection = useRef<boolean>(true);
  const listenerRef = useRef<() => void | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const response = useSWRSubscription<IMemoryUsageItem, any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      const connect = () =>
        MihomoWebSocket.connect_memory()
          .then((ws_) => {
            ws.current = ws_;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            listenerRef.current = ws_.addListener(async (msg) => {
              if (msg.type === "Text") {
                if (msg.data.startsWith("websocket error")) {
                  next(msg.data, { inuse: 0 });
                  await ws.current?.close();
                  ws.current = null;
                  timeoutRef.current = setTimeout(
                    async () => await connect(),
                    500,
                  );
                } else {
                  const data = JSON.parse(msg.data) as IMemoryUsageItem;
                  next(null, data);
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
        listenerRef.current?.();
        listenerRef.current = null;
      };
    },
    {
      fallbackData: { inuse: 0 },
      keepPreviousData: true,
    },
  );

  useEffect(() => {
    const unlistenRefreshWebsocket = listen(
      "verge://refresh-websocket",
      async () => {
        await ws.current?.close();
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

  const refreshGetClashMemory = () => {
    setDate(Date.now());
  };

  return { response, refreshGetClashMemory };
};
