import { useQueryClient } from '@tanstack/react-query'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

const MAX_CLOSED_CONNS_NUM = 500

export const initConnData: ConnectionMonitorData = {
  uploadTotal: 0,
  downloadTotal: 0,
  activeConnections: [],
  closedConnections: [],
}

export interface ConnectionMonitorData {
  uploadTotal: number
  downloadTotal: number
  activeConnections: IConnectionsItem[]
  closedConnections: IConnectionsItem[]
}

const trimClosedConnections = (
  closedConnections: IConnectionsItem[],
): IConnectionsItem[] =>
  closedConnections.length > MAX_CLOSED_CONNS_NUM
    ? closedConnections.slice(-MAX_CLOSED_CONNS_NUM)
    : closedConnections

const mergeConnectionSnapshot = (
  payload: IConnections,
  previous: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const nextConnections = payload.connections ?? []
  const previousActive = previous.activeConnections ?? []
  const nextById = new Map(nextConnections.map((conn) => [conn.id, conn]))

  // Keep surviving connections in their previous relative order to reduce row reshuffle,
  // but constrain the array to the incoming snapshot length.
  const carried = previousActive
    .map((prev) => {
      const next = nextById.get(prev.id)
      if (!next) return null

      nextById.delete(prev.id)
      return {
        ...next,
        curUpload: next.upload - prev.upload,
        curDownload: next.download - prev.download,
      } as IConnectionsItem
    })
    .filter(Boolean) as IConnectionsItem[]

  const newcomers = nextConnections
    .filter((conn) => nextById.has(conn.id))
    .map((conn) => ({
      ...conn,
      curUpload: 0,
      curDownload: 0,
    }))

  const activeConnections = [...carried, ...newcomers]
  const activeIds = new Set(activeConnections.map((conn) => conn.id))

  const closedConnections = trimClosedConnections([
    ...(previous.closedConnections ?? []),
    ...previousActive.filter((conn) => !activeIds.has(conn.id)),
  ])

  return {
    uploadTotal: payload.uploadTotal ?? 0,
    downloadTotal: payload.downloadTotal ?? 0,
    activeConnections,
    closedConnections,
  }
}

export const useConnectionData = () => {
  const queryClient = useQueryClient()
  const { response, refresh, subscriptionCacheKey } =
    useMihomoWsSubscription<ConnectionMonitorData>({
      storageKey: 'mihomo_connection_date',
      buildSubscriptKey: (date) => `getClashConnection-${date}`,
      fallbackData: initConnData,
      connect: () => MihomoWebSocket.connect_connections(),
      throttleMs: 16,
      setupHandlers: ({ next, scheduleReconnect }) => ({
        handleMessage: (data) => {
          if (data.startsWith('Websocket error')) {
            next(data)
            void scheduleReconnect()
            return
          }

          next(null, (old = initConnData) =>
            mergeConnectionSnapshot(JSON.parse(data) as IConnections, old),
          )
        },
      }),
    })

  const clearClosedConnections = () => {
    if (!subscriptionCacheKey) return
    queryClient.setQueryData<ConnectionMonitorData>([subscriptionCacheKey], {
      uploadTotal: response.data?.uploadTotal ?? 0,
      downloadTotal: response.data?.downloadTotal ?? 0,
      activeConnections: response.data?.activeConnections ?? [],
      closedConnections: [],
    })
  }

  return {
    response,
    refreshGetClashConnection: refresh,
    clearClosedConnections,
  }
}
