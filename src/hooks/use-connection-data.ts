import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

const MAX_CLOSED_CONNS_NUM = 500
const CONNECTION_UPDATE_THROTTLE_MS = 500
const CONNECTION_RECONNECT_DELAY_MS = 1_000

type ConnectionMetadata = IConnectionsItem['metadata']
type ConnectionListener = () => void

const metadataValue = (value?: string) => value || ''

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
  activeConnectionCount: number
}

export const initConnSummaryData: ConnectionSummaryData = {
  activeConnectionCount: 0,
}

let connectionData: ConnectionMonitorData = initConnData
let connectionSummary: ConnectionSummaryData = initConnSummaryData
let connectionSocket: MihomoWebSocket | null = null
let connectionStarted = false
let connectionConnecting = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingMessageData: string | null = null
let lastFlushAt = 0

const connectionListeners = new Set<ConnectionListener>()
const summaryListeners = new Set<ConnectionListener>()

const notifyConnectionListeners = () => {
  connectionListeners.forEach((listener) => listener())
}

const notifySummaryListeners = () => {
  summaryListeners.forEach((listener) => listener())
}

const sameMetadata = (left: ConnectionMetadata, right: ConnectionMetadata) =>
  metadataValue(left.network) === metadataValue(right.network) &&
  metadataValue(left.type) === metadataValue(right.type) &&
  metadataValue(left.host) === metadataValue(right.host) &&
  metadataValue(left.sourceIP) === metadataValue(right.sourceIP) &&
  metadataValue(left.sourcePort) === metadataValue(right.sourcePort) &&
  metadataValue(left.destinationPort) ===
    metadataValue(right.destinationPort) &&
  metadataValue(left.destinationIP) === metadataValue(right.destinationIP) &&
  metadataValue(left.remoteDestination) ===
    metadataValue(right.remoteDestination) &&
  metadataValue(left.process) === metadataValue(right.process) &&
  metadataValue(left.processPath) === metadataValue(right.processPath)

const normalizeMetadata = (
  metadata: ConnectionMetadata,
  previous?: ConnectionMetadata,
): ConnectionMetadata => {
  if (previous && sameMetadata(previous, metadata)) return previous

  return {
    network: metadata.network || '',
    type: metadata.type || '',
    host: metadata.host || '',
    sourceIP: metadata.sourceIP || '',
    sourcePort: metadata.sourcePort || '',
    destinationPort: metadata.destinationPort || '',
    destinationIP: metadata.destinationIP || '',
    remoteDestination: metadata.remoteDestination || '',
    process: metadata.process || '',
    processPath: metadata.processPath || '',
  }
}

const sameChains = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

const normalizeChains = (chains: string[], previous?: string[]) => {
  if (previous && sameChains(previous, chains)) return previous
  return chains.slice()
}

const normalizeConnection = (
  connection: IConnectionsItem,
  previous?: IConnectionsItem,
): IConnectionsItem => {
  const metadata = normalizeMetadata(connection.metadata, previous?.metadata)
  const chains = normalizeChains(connection.chains || [], previous?.chains)
  const upload = connection.upload ?? 0
  const download = connection.download ?? 0
  const curUpload = previous ? upload - previous.upload : 0
  const curDownload = previous ? download - previous.download : 0
  const rule = connection.rule || ''
  const rulePayload = connection.rulePayload || ''
  const start = connection.start || ''

  if (
    previous &&
    previous.metadata === metadata &&
    previous.chains === chains &&
    previous.upload === upload &&
    previous.download === download &&
    previous.curUpload === curUpload &&
    previous.curDownload === curDownload &&
    previous.rule === rule &&
    previous.rulePayload === rulePayload &&
    previous.start === start
  ) {
    return previous
  }

  return {
    id: connection.id,
    metadata,
    upload,
    download,
    start,
    chains,
    rule,
    rulePayload,
    curUpload,
    curDownload,
  }
}

const mergeConnectionSnapshot = (
  payload: IConnections,
  previous: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const nextConnections = payload.connections ?? []
  const previousActive = previous.activeConnections ?? []
  const previousClosed = previous.closedConnections ?? []
  const previousActiveById = new Map<string, IConnectionsItem>()

  for (let i = 0; i < previousActive.length; i++) {
    const previousConnection = previousActive[i]
    previousActiveById.set(previousConnection.id, previousConnection)
  }

  const activeConnections: IConnectionsItem[] = []
  for (let i = 0; i < nextConnections.length; i++) {
    const connection = nextConnections[i]
    const previousConnection = previousActiveById.get(connection.id)
    if (previousConnection) previousActiveById.delete(connection.id)
    activeConnections.push(normalizeConnection(connection, previousConnection))
  }

  if (previousActiveById.size === 0) {
    return {
      uploadTotal: payload.uploadTotal ?? 0,
      downloadTotal: payload.downloadTotal ?? 0,
      activeConnections,
      closedConnections: previousClosed,
    }
  }

  const removedConnectionCount = previousActiveById.size
  const dropFromClosed = Math.max(
    0,
    previousClosed.length + removedConnectionCount - MAX_CLOSED_CONNS_NUM,
  )
  const closedConnections =
    dropFromClosed >= previousClosed.length
      ? []
      : previousClosed.slice(dropFromClosed)

  const keepFromRemoved = MAX_CLOSED_CONNS_NUM - closedConnections.length
  let skipRemoved = Math.max(0, removedConnectionCount - keepFromRemoved)

  for (let i = 0; i < previousActive.length; i++) {
    const connection = previousActive[i]
    if (!previousActiveById.has(connection.id)) continue
    if (skipRemoved > 0) {
      skipRemoved -= 1
      continue
    }
    closedConnections.push(connection)
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
  activeConnectionCount: payload.connections?.length ?? 0,
})

const flushPendingMessage = () => {
  flushTimer = null
  const messageData = pendingMessageData
  pendingMessageData = null
  if (!messageData) return

  let payload: IConnections
  try {
    payload = JSON.parse(messageData) as IConnections
  } catch (err) {
    console.error('[Connections] Failed to parse websocket payload', err)
    return
  }

  lastFlushAt = Date.now()
  connectionSummary = mergeConnectionSummary(payload)
  notifySummaryListeners()

  if (connectionListeners.size === 0) return

  connectionData = mergeConnectionSnapshot(payload, connectionData)
  notifyConnectionListeners()
}

const enqueueConnectionMessage = (messageData: string) => {
  pendingMessageData = messageData
  if (flushTimer) return

  const elapsed = Date.now() - lastFlushAt
  if (elapsed >= CONNECTION_UPDATE_THROTTLE_MS) {
    flushPendingMessage()
    return
  }

  flushTimer = window.setTimeout(
    flushPendingMessage,
    CONNECTION_UPDATE_THROTTLE_MS - elapsed,
  )
}

const clearReconnectTimer = () => {
  if (!reconnectTimer) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = null
}

const closeConnectionSocket = async () => {
  const socket = connectionSocket
  connectionSocket = null
  if (!socket) return

  try {
    await socket.close()
  } catch (err) {
    console.warn('Failed to close connection websocket', err)
  }
}

const scheduleReconnect = () => {
  if (reconnectTimer) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    void connectConnectionSocket()
  }, CONNECTION_RECONNECT_DELAY_MS)
}

async function reconnectConnectionSocket() {
  await closeConnectionSocket()
  scheduleReconnect()
}

async function connectConnectionSocket() {
  if (connectionSocket || connectionConnecting) return

  clearReconnectTimer()
  connectionConnecting = true

  try {
    const socket = await MihomoWebSocket.connect_connections()
    connectionSocket = socket
    socket.addListener((message) => {
      if (message.type !== 'Text') return
      if (message.data.startsWith('Websocket error')) {
        void reconnectConnectionSocket()
        return
      }

      enqueueConnectionMessage(message.data)
    })
  } catch {
    scheduleReconnect()
  } finally {
    connectionConnecting = false
  }
}

const startConnectionMonitor = () => {
  if (connectionStarted) return
  connectionStarted = true
  void connectConnectionSocket()
}

const getConnectionSnapshot = () => connectionData
const getConnectionSummarySnapshot = () => connectionSummary

const subscribeConnectionData = (listener: ConnectionListener) => {
  startConnectionMonitor()
  connectionListeners.add(listener)
  return () => {
    connectionListeners.delete(listener)
  }
}

const subscribeConnectionSummary = (listener: ConnectionListener) => {
  startConnectionMonitor()
  summaryListeners.add(listener)
  return () => {
    summaryListeners.delete(listener)
  }
}

const refreshConnectionData = () => {
  pendingMessageData = null
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }

  void reconnectConnectionSocket()
}

const clearClosedConnectionData = () => {
  if (connectionData.closedConnections.length === 0) return
  connectionData = {
    ...connectionData,
    closedConnections: [],
  }
  notifyConnectionListeners()
}

export const useConnectionData = () => {
  const data = useSyncExternalStore(
    subscribeConnectionData,
    getConnectionSnapshot,
    getConnectionSnapshot,
  )
  const response = useMemo(() => ({ data }), [data])
  const refreshGetClashConnection = useCallback(() => {
    refreshConnectionData()
  }, [])
  const clearClosedConnections = useCallback(() => {
    clearClosedConnectionData()
  }, [])

  return {
    response,
    refreshGetClashConnection,
    clearClosedConnections,
  }
}

export const useConnectionSummaryData = () => {
  const data = useSyncExternalStore(
    subscribeConnectionSummary,
    getConnectionSummarySnapshot,
    getConnectionSummarySnapshot,
  )
  const response = useMemo(() => ({ data }), [data])
  const refreshGetClashConnectionSummary = useCallback(() => {
    refreshConnectionData()
  }, [])

  return {
    response,
    refreshGetClashConnectionSummary,
  }
}
