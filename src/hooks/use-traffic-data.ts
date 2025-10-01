import { TrafficRef } from "@/components/layout/traffic-graph";
import { listen } from "@tauri-apps/api/event";
import { useLocalStorage } from "foxact/use-local-storage";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

export const useTrafficData = () => {
  const [date, setDate] = useLocalStorage("mihomo_traffic_date", Date.now());
  const subscriptKey = `getClashTraffic-${date}`;

  const trafficRef = useRef<TrafficRef>(null);
  const ws = useRef<MihomoWebSocket | null>(null);
  const wsFirstConnection = useRef<boolean>(true);
  const listenerRef = useRef<() => void | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const response = useSWRSubscription<ITrafficItem, any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      const connect = async () => {
        MihomoWebSocket.connect_traffic()
          .then(async (ws_) => {
            ws.current = ws_;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            listenerRef.current = ws_.addListener(async (msg) => {
              if (msg.type === "Text") {
                if (msg.data.startsWith("Websocket error")) {
                  next(msg.data, { up: 0, down: 0 });
                  await ws.current?.close();
                  ws.current = null;
                  timeoutRef.current = setTimeout(
                    async () => await connect(),
                    500,
                  );
                } else {
                  const data = JSON.parse(msg.data) as ITrafficItem;
                  trafficRef.current?.appendData(data);
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
      };

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
      fallbackData: { up: 0, down: 0 },
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
  }, [setDate]);

  useEffect(() => {
    mutate(`$sub$${subscriptKey}`);
  }, [date, subscriptKey]);

  const refreshGetClashTraffic = () => {
    setDate(Date.now());
  };

  return { response, refreshGetClashTraffic };
};
