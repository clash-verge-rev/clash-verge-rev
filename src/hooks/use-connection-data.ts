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
  const wsFirstConnection = useRef<boolean>(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const response = useSWRSubscription<IConnections, any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      const reconnect = async () => {
        await ws.current?.close();
        ws.current = null;
        timeoutRef.current = setTimeout(async () => await connect(), 500);
      };

      const connect = () =>
        MihomoWebSocket.connect_connections()
          .then((ws_) => {
            ws.current = ws_;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            ws_.addListener(async (msg) => {
              if (msg.type === "Text") {
                if (msg.data.startsWith("Websocket error")) {
                  next(msg.data);
                  await reconnect();
                } else {
                  const data = JSON.parse(msg.data) as IConnections;
                  next(null, (old = initConnData) => {
                    const oldConn = old.connections;
                    const maxLen = data.connections?.length || 0;
                    const idToOldIndex = new Map<string, number>(
                      oldConn.map((o, idx) => [o.id, idx]),
                    );
                    const connections: IConnectionsItem[] = new Array(maxLen);
                    const rest = (data.connections || []).filter((each) => {
                      const index = idToOldIndex.get(each.id);
                      if (index !== undefined && index >= 0 && index < maxLen) {
                        const oldItem = oldConn[index];
                        each.curUpload = each.upload - oldItem.upload;
                        each.curDownload = each.download - oldItem.download;
                        connections[index] = each;
                        return false;
                      }
                      return true;
                    });
                    for (let i = 0; i < maxLen; ++i) {
                      if (!connections[i] && rest.length > 0) {
                        const item = rest.shift()!;
                        item.curUpload = 0;
                        item.curDownload = 0;
                        connections[i] = item;
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
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        ws.current?.close();
        ws.current = null;
      };
    },
    {
      fallbackData: initConnData,
      keepPreviousData: true,
    },
  );

  useEffect(() => {
    mutate(`$sub$${subscriptKey}`);
  }, [date, subscriptKey]);

  const refreshGetClashConnection = () => {
    setDate(Date.now());
  };

  return { response, refreshGetClashConnection };
};
