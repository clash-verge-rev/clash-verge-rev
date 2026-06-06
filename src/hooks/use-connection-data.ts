import { useQueryClient } from '@tanstack/react-query'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

const MAX_CLOSED_CONNS_NUM = 500
const CONNECTION_UPDATE_THROTTLE_MS = 500
const CONNECTION_QUERY_GC_TIME_MS = 1_000

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

export interface ConnectionSummaryData {
  uploadTotal: number
  downloadTotal: number
  activeConnectionCount: number
}

export const initConnSummaryData: ConnectionSummaryData = {
  uploadTotal: 0,
  downloadTotal: 0,
  activeConnectionCount: 0,
}

const mergeConnectionSnapshot = (
  payload: IConnections,
  previous: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const nextConnections = payload.connections ?? []
  const previousActive = previous.activeConnections ?? []
  const previousClosed = previous.closedConnections ?? []

  const nextById = new Map<string, IConnectionsItem>()
  for (let i = 0; i < nextConnections.length; i++) {
    nextById.set(nextConnections[i].id, nextConnections[i])
  }

  const carried: IConnectionsItem[] = []
  const dropped: IConnectionsItem[] = []

  for (let i = 0; i < previousActive.length; i++) {
    const prev = previousActive[i]
    const next = nextById.get(prev.id)
    if (next !== undefined) {
      nextById.delete(prev.id)
      if (prev.upload === next.upload && prev.download === next.download) {
        // Reuse prev reference: row identity stability is the contract Stage 2 memo relies on.
        carried.push(prev)
      } else {
        carried.push({
          ...next,
          curUpload: next.upload - prev.upload,
          curDownload: next.download - prev.download,
        })
      }
    } else {
      dropped.push(prev)
    }
  }

  const activeConnections: IConnectionsItem[] = carried
  for (let i = 0; i < nextConnections.length; i++) {
    const conn = nextConnections[i]
    if (nextById.has(conn.id)) {
      activeConnections.push({
        ...conn,
        curUpload: 0,
        curDownload: 0,
      })
    }
  }

  if (dropped.length === 0) {
    return {
      uploadTotal: payload.uploadTotal ?? 0,
      downloadTotal: payload.downloadTotal ?? 0,
      activeConnections,
      closedConnections: previousClosed,
    }
  }

  const rawClosedLen = previousClosed.length + dropped.length
  let closedConnections: IConnectionsItem[]
  if (rawClosedLen <= MAX_CLOSED_CONNS_NUM) {
    closedConnections = previousClosed.concat(dropped)
  } else {
    const skipPrev = rawClosedLen - MAX_CLOSED_CONNS_NUM
    closedConnections =
      skipPrev >= previousClosed.length
        ? dropped.slice(skipPrev - previousClosed.length)
        : previousClosed.slice(skipPrev).concat(dropped)
  }

  return {
    uploadTotal: payload.uploadTotal ?? 0,
    downloadTotal: payload.downloadTotal ?? 0,
    activeConnections,
    closedConnections,
  }
}

const mergeConnectionSummary = (
  payload: IConnections,
): ConnectionSummaryData => ({
  uploadTotal: payload.uploadTotal ?? 0,
  downloadTotal: payload.downloadTotal ?? 0,
  activeConnectionCount: payload.connections?.length ?? 0,
})

export const useConnectionData = () => {
  const queryClient = useQueryClient()
  const { response, refresh, subscriptionCacheKey } =
    useMihomoWsSubscription<ConnectionMonitorData>({
      storageKey: 'mihomo_connection_date',
      buildSubscriptKey: (date) => `getClashConnection-${date}`,
      fallbackData: initConnData,
      connect: () => MihomoWebSocket.connect_connections(),
      throttleMs: CONNECTION_UPDATE_THROTTLE_MS,
      gcTime: CONNECTION_QUERY_GC_TIME_MS,
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

export const useConnectionSummaryData = () => {
  const { response, refresh } = useMihomoWsSubscription<ConnectionSummaryData>({
    storageKey: 'mihomo_connection_summary_date',
    buildSubscriptKey: (date) => `getClashConnectionSummary-${date}`,
    fallbackData: initConnSummaryData,
    connect: () => MihomoWebSocket.connect_connections(),
    throttleMs: CONNECTION_UPDATE_THROTTLE_MS,
    setupHandlers: ({ next, scheduleReconnect }) => ({
      handleMessage: (data) => {
        if (data.startsWith('Websocket error')) {
          next(data)
          void scheduleReconnect()
          return
        }

        next(null, mergeConnectionSummary(JSON.parse(data) as IConnections))
      },
    }),
  })

  return {
    response,
    refreshGetClashConnectionSummary: refresh,
  }
}
