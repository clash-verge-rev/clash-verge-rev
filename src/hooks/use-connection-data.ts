import { listen } from "@tauri-apps/api/event";
import { useLocalStorage } from "foxact/use-local-storage";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

export const initConnData: IConnections = {
  uploadTotal: 0,
  downloadTotal: 0,
  connections: [],
};

export const useConnectionData = () => {
  const [date, setDate] = useLocalStorage("mihomo_connection_date", Date.now());
  const subscriptKey = `getClashConnection-${date}`;

  const ws = useRef<MihomoWebSocket | null>(null);
  const ws_first_connection = useRef<boolean>(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const response = useSWRSubscription<IConnections, any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      const connect = () =>
        MihomoWebSocket.connect_connections()
          .then((ws_) => {
            ws.current = ws_;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            ws_.addListener(async (msg) => {
              if (msg.type === "Text") {
                if (msg.data.startsWith("websocket error")) {
                  next(msg.data);
                  await ws.current?.close();
                  ws.current = null;
                  timeoutRef.current = setTimeout(
                    async () => await connect(),
                    500,
                  );
                } else {
                  const data = JSON.parse(msg.data) as IConnections;
                  next(null, (old = initConnData) => {
                    const oldConn = old.connections;
                    const maxLen = data.connections?.length;
                    const connections: IConnectionsItem[] = [];
                    const rest = (data.connections || []).filter((each) => {
                      const index = oldConn.findIndex((o) => o.id === each.id);
                      if (index >= 0 && index < maxLen) {
                        const old = oldConn[index];
                        each.curUpload = each.upload - old.upload;
                        each.curDownload = each.download - old.download;
                        connections[index] = each;
                        return false;
                      }
                      return true;
                    });
                    for (let i = 0; i < maxLen; ++i) {
                      if (!connections[i] && rest.length > 0) {
                        connections[i] = rest.shift()!;
                        connections[i].curUpload = 0;
                        connections[i].curDownload = 0;
                      }
                    }
                    return { ...data, connections };
                  });
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
      fallbackData: initConnData,
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

  const refreshGetClashConnection = () => {
    setDate(Date.now());
  };

  return { response, refreshGetClashConnection };
};
