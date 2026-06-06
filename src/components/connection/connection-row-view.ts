import { useCallback, useMemo, useRef } from 'react'

const TRAFFIC_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

export interface ConnectionRowView {
  id: string
  host: string
  process: string
  network: string
  type: string
  chains: string
  rule: string
  time: string
  source: string
  destination: string
  uploadText: string
  downloadText: string
  uploadSpeedText: string
  downloadSpeedText: string
  upload: number
  download: number
  uploadSpeed: number
  downloadSpeed: number
  startTime: number
  searchableHost: string
  searchableDestinationIP: string
  searchableProcess: string
}

export interface ConnectionRowViews {
  rows: ConnectionRowView[]
  getConnectionById: (id: string) => IConnectionsItem | undefined
}

const formatTraffic = (value?: number) => {
  if (typeof value !== 'number') return 'NaN'

  const exp =
    value < 1
      ? 0
      : Math.min(Math.floor(Math.log2(value) / 10), TRAFFIC_UNITS.length - 1)
  const data = value / 1024 ** exp
  const text = data >= 1000 ? data.toFixed(0) : data.toPrecision(3)
  return `${text} ${TRAFFIC_UNITS[exp]}`
}

const formatChains = (chains: string[]) => {
  let value = ''
  for (let i = chains.length - 1; i >= 0; i -= 1) {
    if (value) value += ' / '
    value += chains[i]
  }
  return value
}

const createConnectionRowView = (connection: IConnectionsItem) => {
  const { metadata, rulePayload } = connection
  const destination = metadata.destinationIP
    ? `${metadata.destinationIP}:${metadata.destinationPort}`
    : `${metadata.remoteDestination}:${metadata.destinationPort}`
  const host = metadata.host
    ? `${metadata.host}:${metadata.destinationPort}`
    : `${metadata.remoteDestination}:${metadata.destinationPort}`
  const uploadSpeed = connection.curUpload ?? 0
  const downloadSpeed = connection.curDownload ?? 0

  return {
    id: connection.id,
    host,
    process: metadata.process || metadata.processPath || '',
    network: metadata.network,
    type: metadata.type,
    chains: formatChains(connection.chains),
    rule: rulePayload ? `${connection.rule}(${rulePayload})` : connection.rule,
    time: connection.start,
    source: `${metadata.sourceIP}:${metadata.sourcePort}`,
    destination,
    uploadText: formatTraffic(connection.upload),
    downloadText: formatTraffic(connection.download),
    uploadSpeedText: `${formatTraffic(uploadSpeed)}/s`,
    downloadSpeedText: `${formatTraffic(downloadSpeed)}/s`,
    upload: connection.upload ?? 0,
    download: connection.download ?? 0,
    uploadSpeed,
    downloadSpeed,
    startTime: Date.parse(connection.start || '') || 0,
    searchableHost: metadata.host || '',
    searchableDestinationIP: metadata.destinationIP || '',
    searchableProcess: metadata.process || '',
  } satisfies ConnectionRowView
}

const sameConnectionRowView = (
  left: ConnectionRowView,
  right: ConnectionRowView,
) =>
  left.host === right.host &&
  left.process === right.process &&
  left.network === right.network &&
  left.type === right.type &&
  left.chains === right.chains &&
  left.rule === right.rule &&
  left.time === right.time &&
  left.source === right.source &&
  left.destination === right.destination &&
  left.uploadText === right.uploadText &&
  left.downloadText === right.downloadText &&
  left.uploadSpeedText === right.uploadSpeedText &&
  left.downloadSpeedText === right.downloadSpeedText &&
  left.upload === right.upload &&
  left.download === right.download &&
  left.uploadSpeed === right.uploadSpeed &&
  left.downloadSpeed === right.downloadSpeed &&
  left.startTime === right.startTime &&
  left.searchableHost === right.searchableHost &&
  left.searchableDestinationIP === right.searchableDestinationIP &&
  left.searchableProcess === right.searchableProcess

export const useConnectionRowViews = (
  connections: IConnectionsItem[],
): ConnectionRowViews => {
  const previousRowsRef = useRef(new Map<string, ConnectionRowView>())
  const latestConnectionsRef = useRef(new Map<string, IConnectionsItem>())

  const rows = useMemo(() => {
    const previousRows = previousRowsRef.current
    const previousConnections = latestConnectionsRef.current
    const nextRows = new Map<string, ConnectionRowView>()
    const latestConnections = new Map<string, IConnectionsItem>()
    const nextList: ConnectionRowView[] = []

    connections.forEach((connection) => {
      latestConnections.set(connection.id, connection)

      const previousRow = previousRows.get(connection.id)
      const previousConnection = previousConnections.get(connection.id)
      let row: ConnectionRowView
      if (previousRow && previousConnection === connection) {
        row = previousRow
      } else {
        const nextRow = createConnectionRowView(connection)
        row =
          previousRow && sameConnectionRowView(previousRow, nextRow)
            ? previousRow
            : nextRow
      }

      nextRows.set(connection.id, row)
      nextList.push(row)
    })

    previousRowsRef.current = nextRows
    latestConnectionsRef.current = latestConnections
    return nextList
  }, [connections])

  const getConnectionById = useCallback(
    (id: string) => latestConnectionsRef.current.get(id),
    [],
  )

  return { rows, getConnectionById }
}
