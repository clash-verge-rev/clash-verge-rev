import { mutate } from "swr";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

import { useMihomoWsSubscription } from "./use-mihomo-ws-subscription";

const MAX_CLOSED_CONNS_NUM = 500;

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

const trimClosedConnections = (
  closedConnections: IConnectionsItem[],
): IConnectionsItem[] =>
  closedConnections.length > MAX_CLOSED_CONNS_NUM
    ? closedConnections.slice(-MAX_CLOSED_CONNS_NUM)
    : closedConnections;

const mergeConnectionSnapshot = (
  payload: IConnections,
  previous: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const nextConnections = payload.connections ?? [];
  const previousActive = previous.activeConnections ?? [];
  const nextById = new Map(nextConnections.map((conn) => [conn.id, conn]));
  const newIds = new Set(nextConnections.map((conn) => conn.id));

  // Keep surviving connections in their previous relative order to reduce row reshuffle,
  // but constrain the array to the incoming snapshot length.
  const carried = previousActive
    .map((prev) => {
      const next = nextById.get(prev.id);
      if (!next) return null;

      nextById.delete(prev.id);
      return {
        ...next,
        curUpload: next.upload - prev.upload,
        curDownload: next.download - prev.download,
      } as IConnectionsItem;
    })
    .filter(Boolean) as IConnectionsItem[];

  const newcomers = nextConnections
    .filter((conn) => nextById.has(conn.id))
    .map((conn) => ({
      ...conn,
      curUpload: 0,
      curDownload: 0,
    }));

  const activeConnections = [...carried, ...newcomers];

  const closedConnections = trimClosedConnections([
    ...(previous.closedConnections ?? []),
    ...previousActive.filter((conn) => !newIds.has(conn.id)),
  ]);

  return {
    uploadTotal: payload.uploadTotal ?? 0,
    downloadTotal: payload.downloadTotal ?? 0,
    activeConnections,
    closedConnections,
  };
};

export const useConnectionData = () => {
  const { response, refresh, subscriptionCacheKey } =
    useMihomoWsSubscription<ConnectionMonitorData>({
      storageKey: "mihomo_connection_date",
      buildSubscriptKey: (date) => `getClashConnection-${date}`,
      fallbackData: initConnData,
      connect: () => MihomoWebSocket.connect_connections(),
      setupHandlers: ({ next, scheduleReconnect }) => ({
        handleMessage: (data) => {
          if (data.startsWith("Websocket error")) {
            next(data);
            void scheduleReconnect();
            return;
          }

          try {
            const parsed = JSON.parse(data) as IConnections;
            next(null, (old = initConnData) =>
              mergeConnectionSnapshot(parsed, old),
            );
          } catch (error) {
            next(error);
          }
        },
      }),
    });

  const clearClosedConnections = () => {
    if (!subscriptionCacheKey) return;
    mutate(subscriptionCacheKey, {
      uploadTotal: response.data?.uploadTotal ?? 0,
      downloadTotal: response.data?.downloadTotal ?? 0,
      activeConnections: response.data?.activeConnections ?? [],
      closedConnections: [],
    });
  };

  return {
    response,
    refreshGetClashConnection: refresh,
    clearClosedConnections,
  };
};
