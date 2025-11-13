import { useLocalStorage } from "foxact/use-local-storage";
import { useEffect, useRef } from "react";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

export const initConnData: ConnectionMonitorData = {
  uploadTotal: 0,
  downloadTotal: 0,
  activeConnections: [],
  closedConnections: [],
};

export interface ConnectionMonitorData {
  uploadTotal: number;
  downloadTotal: number;
  activeConnections: IConnectionsItem[];
  closedConnections: IConnectionsItem[];
}

const MAX_CLOSED_CONNS_NUM = 500;

export const useConnectionData = () => {
  const [date, setDate] = useLocalStorage("mihomo_connection_date", Date.now());
  const subscriptKey = `getClashConnection-${date}`;

  const ws = useRef<MihomoWebSocket | null>(null);
  const wsFirstConnection = useRef<boolean>(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const response = useSWRSubscription<
    ConnectionMonitorData,
    any,
    string | null
  >(
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
                    const oldConn = old.activeConnections;
                    const maxLen = data.connections?.length;
                    const activeConns: IConnectionsItem[] = [];
                    const rest = (data.connections || []).filter((each) => {
                      const index = oldConn.findIndex((o) => o.id === each.id);
                      if (index >= 0 && index < maxLen) {
                        const old = oldConn[index];
                        each.curUpload = each.upload - old.upload;
                        each.curDownload = each.download - old.download;
                        activeConns[index] = each;
                        return false;
                      }
                      return true;
                    });
                    for (let i = 0; i < maxLen; ++i) {
                      if (!activeConns[i] && rest.length > 0) {
                        activeConns[i] = rest.shift()!;
                        activeConns[i].curUpload = 0;
                        activeConns[i].curDownload = 0;
                      }
                    }
                    const currentClosedConns = oldConn.filter((each) => {
                      const index = activeConns.findIndex(
                        (o) => o.id === each.id,
                      );
                      return index < 0;
                    });
                    let closedConns =
                      old.closedConnections.concat(currentClosedConns);
                    if (closedConns.length > 500) {
                      closedConns = closedConns.slice(-MAX_CLOSED_CONNS_NUM);
                    }
                    return {
                      uploadTotal: data.uploadTotal,
                      downloadTotal: data.downloadTotal,
                      activeConnections: activeConns,
                      closedConnections: closedConns,
                    };
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

  const clearClosedConnections = () => {
    mutate(`$sub$${subscriptKey}`, {
      uploadTotal: response.data?.uploadTotal ?? 0,
      downloadTotal: response.data?.downloadTotal ?? 0,
      activeConnections: response.data?.activeConnections ?? [],
      closedConnections: [],
    });
  };

  return { response, refreshGetClashConnection, clearClosedConnections };
};
