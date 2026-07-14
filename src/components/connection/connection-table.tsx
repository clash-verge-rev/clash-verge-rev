import { useTheme } from '@mui/material/styles'
import { useLocalStorage } from 'foxact/use-local-storage'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  ConnectionColumnManager,
  type ConnectionColumnOption,
} from './connection-column-manager'
import { RelativeTime } from './connection-relative-time'
import {
  formatConnectionChains,
  formatConnectionTraffic,
  getConnectionDestination,
  getConnectionHost,
  getConnectionProcess,
  getConnectionRule,
  getConnectionSource,
  getConnectionStartTime,
  getConnectionTypeLabel,
} from './connection-row-view'

const ROW_HEIGHT = 40
const RESIZE_HANDLE_WIDTH = 6
const OVERSCAN_ROWS = 6
const MAX_ROW_SNAPSHOT_CACHE_SIZE = 2_000

const reconcileColumnOrder = (
  storedOrder: string[],
  baseFields: string[],
): string[] => {
  const filtered = storedOrder.filter((field) => baseFields.includes(field))
  const missing = baseFields.filter((field) => !filtered.includes(field))
  return [...filtered, ...missing]
}

type ColumnField =
  | 'host'
  | 'download'
  | 'upload'
  | 'dlSpeed'
  | 'ulSpeed'
  | 'chains'
  | 'rule'
  | 'process'
  | 'time'
  | 'source'
  | 'remoteDestination'
  | 'type'

type ColumnSizingState = Record<string, number>
type VisibilityState = Record<string, boolean>

interface BaseColumn {
  field: ColumnField
  headerName: string
  width: number
  minWidth: number
  maxWidth?: number
  align?: 'left' | 'right'
  cell?: (row: IConnectionsItem, snapshot: TableRowSnapshot) => string
}

interface DisplayColumn extends BaseColumn {
  size: number
}

interface SortingState {
  id: ColumnField
  desc: boolean
}

interface TableRowSnapshot {
  row: IConnectionsItem
  host: string
  process: string
  source: string
  destination: string
  chainsText: string
  ruleText: string
  typeLabel: string
  startTime: number
  uploadText: string
  downloadText: string
  uploadSpeedText: string
  downloadSpeedText: string
}

const resolveColumnSize = (
  column: BaseColumn,
  storedSize: number | undefined,
) => {
  if (typeof storedSize !== 'number' || !Number.isFinite(storedSize)) {
    return column.width
  }

  const boundedMin = Math.max(column.minWidth, storedSize)
  return column.maxWidth === undefined
    ? boundedMin
    : Math.min(column.maxWidth, boundedMin)
}

const sameStaticConnection = (
  left: IConnectionsItem,
  right: IConnectionsItem,
) =>
  left.metadata === right.metadata &&
  left.chains === right.chains &&
  left.rule === right.rule &&
  left.rulePayload === right.rulePayload &&
  left.start === right.start

const sameTrafficConnection = (
  left: IConnectionsItem,
  right: IConnectionsItem,
) =>
  left.upload === right.upload &&
  left.download === right.download &&
  left.curUpload === right.curUpload &&
  left.curDownload === right.curDownload

const createTableRowSnapshot = (
  row: IConnectionsItem,
  previous?: TableRowSnapshot,
) => {
  const previousRow = previous?.row
  const sameStatic = previousRow && sameStaticConnection(previousRow, row)
  const sameTraffic = previousRow && sameTrafficConnection(previousRow, row)

  if (sameStatic && sameTraffic && previous) return previous

  const upload = row.upload ?? 0
  const download = row.download ?? 0
  const curUpload = row.curUpload ?? 0
  const curDownload = row.curDownload ?? 0

  return {
    row,
    host: sameStatic && previous ? previous.host : getConnectionHost(row),
    process:
      sameStatic && previous ? previous.process : getConnectionProcess(row),
    source: sameStatic && previous ? previous.source : getConnectionSource(row),
    destination:
      sameStatic && previous
        ? previous.destination
        : getConnectionDestination(row),
    chainsText:
      sameStatic && previous
        ? previous.chainsText
        : formatConnectionChains(row.chains),
    ruleText:
      sameStatic && previous ? previous.ruleText : getConnectionRule(row),
    typeLabel:
      sameStatic && previous ? previous.typeLabel : getConnectionTypeLabel(row),
    startTime:
      sameStatic && previous ? previous.startTime : getConnectionStartTime(row),
    uploadText:
      sameTraffic && previous
        ? previous.uploadText
        : formatConnectionTraffic(upload),
    downloadText:
      sameTraffic && previous
        ? previous.downloadText
        : formatConnectionTraffic(download),
    uploadSpeedText:
      sameTraffic && previous
        ? previous.uploadSpeedText
        : `${formatConnectionTraffic(curUpload)}/s`,
    downloadSpeedText:
      sameTraffic && previous
        ? previous.downloadSpeedText
        : `${formatConnectionTraffic(curDownload)}/s`,
  }
}

const getConnectionCellValue = (
  field: ColumnField,
  snapshot: TableRowSnapshot,
) => {
  switch (field) {
    case 'host':
      return snapshot.host
    case 'download':
      return snapshot.row.download ?? 0
    case 'upload':
      return snapshot.row.upload ?? 0
    case 'dlSpeed':
      return snapshot.row.curDownload ?? 0
    case 'ulSpeed':
      return snapshot.row.curUpload ?? 0
    case 'chains':
      return snapshot.chainsText
    case 'rule':
      return snapshot.ruleText
    case 'process':
      return snapshot.process
    case 'time':
      return snapshot.startTime
    case 'source':
      return snapshot.source
    case 'remoteDestination':
      return snapshot.destination
    case 'type':
      return snapshot.typeLabel
    default:
      return ''
  }
}

const compareConnectionCellValue = (
  field: ColumnField,
  left: IConnectionsItem,
  right: IConnectionsItem,
  getSnapshot: (row: IConnectionsItem) => TableRowSnapshot,
) => {
  const leftValue = getConnectionCellValue(field, getSnapshot(left))
  const rightValue = getConnectionCellValue(field, getSnapshot(right))

  if (typeof leftValue === 'number' || typeof rightValue === 'number') {
    return (Number(leftValue) || 0) - (Number(rightValue) || 0)
  }

  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''))
}

const renderCell = (
  column: DisplayColumn,
  row: IConnectionsItem,
  snapshot: TableRowSnapshot,
) => {
  if (column.cell) return column.cell(row, snapshot)
  if (column.field === 'time')
    return <RelativeTime start={snapshot.row.start} />
  return getConnectionCellValue(column.field, snapshot)
}

interface RowComponentProps {
  row: IConnectionsItem
  columns: DisplayColumn[]
  onShowDetail: (id: string) => void
  getSnapshot: (row: IConnectionsItem) => TableRowSnapshot
  borderColor: string
  virtualTop: number
}

const RowComponent = memo(
  function RowComponent({
    row,
    columns,
    onShowDetail,
    getSnapshot,
    borderColor,
    virtualTop,
  }: RowComponentProps) {
    const handleClick = useCallback(
      () => onShowDetail(row.id),
      [onShowDetail, row.id],
    )
    const snapshot = getSnapshot(row)

    return (
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: virtualTop,
          left: 0,
          right: 0,
          height: ROW_HEIGHT,
          cursor: 'pointer',
          borderBottom: `1px solid ${borderColor}`,
        }}
        onClick={handleClick}
      >
        {columns.map((column) => (
          <div
            key={column.field}
            style={{
              boxSizing: 'border-box',
              flex: `0 0 ${column.size}px`,
              minWidth: column.minWidth,
              maxWidth: column.maxWidth,
              padding: '8px',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                column.align === 'right' ? 'flex-end' : 'flex-start',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {renderCell(column, row, snapshot)}
          </div>
        ))}
      </div>
    )
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.columns === next.columns &&
    prev.virtualTop === next.virtualTop &&
    prev.onShowDetail === next.onShowDetail &&
    prev.getSnapshot === next.getSnapshot &&
    prev.borderColor === next.borderColor,
)

interface Props {
  connections: IConnectionsItem[]
  onShowDetail: (id: string) => void
  columnManagerOpen: boolean
  onCloseColumnManager: () => void
}

export const ConnectionTable = (props: Props) => {
  const {
    connections,
    onShowDetail: rawOnShowDetail,
    columnManagerOpen,
    onCloseColumnManager,
  } = props
  const onShowDetailRef = useRef(rawOnShowDetail)
  onShowDetailRef.current = rawOnShowDetail
  const onShowDetail = useCallback(
    (id: string) => onShowDetailRef.current(id),
    [],
  )
  const { t } = useTranslation()
  const theme = useTheme()
  const [columnWidths, setColumnWidths] = useLocalStorage<ColumnSizingState>(
    'connection-table-widths',
    {},
  )

  const [columnVisibilityModel, setColumnVisibilityModel] =
    useLocalStorage<VisibilityState>(
      'connection-table-visibility',
      {},
      {
        serializer: JSON.stringify,
        deserializer: (value) => {
          try {
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === 'object') return parsed
          } catch (err) {
            console.warn('Failed to parse connection-table-visibility', err)
          }
          return {}
        },
      },
    )

  const [columnOrder, setColumnOrder] = useLocalStorage<string[]>(
    'connection-table-order',
    [],
    {
      serializer: JSON.stringify,
      deserializer: (value) => {
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) return parsed
        } catch (err) {
          console.warn('Failed to parse connection-table-order', err)
        }
        return []
      },
    },
  )

  const baseColumns = useMemo<BaseColumn[]>(() => {
    return [
      {
        field: 'host',
        headerName: t('connections.components.fields.host'),
        width: 180,
        minWidth: 140,
      },
      {
        field: 'download',
        headerName: t('shared.labels.downloaded'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.downloadText,
      },
      {
        field: 'upload',
        headerName: t('shared.labels.uploaded'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.uploadText,
      },
      {
        field: 'dlSpeed',
        headerName: t('connections.components.fields.dlSpeed'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.downloadSpeedText,
      },
      {
        field: 'ulSpeed',
        headerName: t('connections.components.fields.ulSpeed'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.uploadSpeedText,
      },
      {
        field: 'chains',
        headerName: t('connections.components.fields.chains'),
        width: 280,
        minWidth: 160,
      },
      {
        field: 'rule',
        headerName: t('connections.components.fields.rule'),
        width: 220,
        minWidth: 160,
      },
      {
        field: 'process',
        headerName: t('connections.components.fields.process'),
        width: 180,
        minWidth: 140,
      },
      {
        field: 'time',
        headerName: t('connections.components.fields.time'),
        width: 100,
        minWidth: 80,
        align: 'right',
      },
      {
        field: 'source',
        headerName: t('connections.components.fields.source'),
        width: 160,
        minWidth: 120,
      },
      {
        field: 'remoteDestination',
        headerName: t('connections.components.fields.destination'),
        width: 160,
        minWidth: 120,
      },
      {
        field: 'type',
        headerName: t('connections.components.fields.type'),
        width: 120,
        minWidth: 80,
      },
    ]
  }, [t])

  useEffect(() => {
    setColumnOrder((prevValue) => {
      const baseFields = baseColumns.map((col) => col.field)
      const prev = Array.isArray(prevValue) ? prevValue : []
      const reconciled = reconcileColumnOrder(prev, baseFields)
      if (
        reconciled.length === prev.length &&
        reconciled.every((field, i) => field === prev[i])
      ) {
        return prevValue
      }
      return reconciled
    })
  }, [baseColumns, setColumnOrder])

  const orderedColumns = useMemo(() => {
    const baseFields = baseColumns.map((column) => column.field)
    const reconciledOrder = reconcileColumnOrder(columnOrder, baseFields)
    const byField: Partial<Record<ColumnField, BaseColumn>> = {}
    baseColumns.forEach((column) => {
      byField[column.field] = column
    })

    return reconciledOrder
      .map((field) => byField[field as ColumnField])
      .filter((column): column is BaseColumn => Boolean(column))
  }, [baseColumns, columnOrder])

  const visibleColumns = useMemo<DisplayColumn[]>(() => {
    return orderedColumns
      .filter(
        (column) => (columnVisibilityModel?.[column.field] ?? true) !== false,
      )
      .map((column) => ({
        ...column,
        size: resolveColumnSize(column, columnWidths?.[column.field]),
      }))
  }, [columnVisibilityModel, columnWidths, orderedColumns])

  const [sorting, setSorting] = useState<SortingState | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const rowSnapshotCacheRef = useRef(new Map<string, TableRowSnapshot>())
  const getRowSnapshot = useCallback((row: IConnectionsItem) => {
    const cache = rowSnapshotCacheRef.current
    const snapshot = createTableRowSnapshot(row, cache.get(row.id))
    cache.set(row.id, snapshot)
    if (cache.size > MAX_ROW_SNAPSHOT_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value
      if (oldestKey && oldestKey !== row.id) cache.delete(oldestKey)
    }
    return snapshot
  }, [])
  const updateViewport = useCallback((element: HTMLDivElement) => {
    setViewport((current) => {
      const next = {
        scrollTop: element.scrollTop,
        height: element.clientHeight,
      }
      return current.scrollTop === next.scrollTop &&
        current.height === next.height
        ? current
        : next
    })
  }, [])

  const setScrollContainer = useCallback(
    (element: HTMLDivElement | null) => {
      scrollContainerRef.current = element
      if (element) updateViewport(element)
    },
    [updateViewport],
  )

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateViewport(element)
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }

    const observer = new ResizeObserver(() => updateViewport(element))
    observer.observe(element)
    return () => observer.disconnect()
  }, [updateViewport])

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    const maxScrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight,
    )
    if (element.scrollTop <= maxScrollTop) return

    element.scrollTop = maxScrollTop
  }, [connections.length])

  useEffect(() => {
    const cache = rowSnapshotCacheRef.current
    if (cache.size <= connections.length + OVERSCAN_ROWS * 4) return

    const activeIds = new Set<string>()
    for (let i = 0; i < connections.length; i++) {
      activeIds.add(connections[i].id)
    }
    cache.forEach((_, id) => {
      if (!activeIds.has(id)) cache.delete(id)
    })
  }, [connections])

  const sortedConnections = useMemo(() => {
    if (!sorting) return connections

    const direction = sorting.desc ? -1 : 1
    return [...connections].sort(
      (left, right) =>
        compareConnectionCellValue(sorting.id, left, right, getRowSnapshot) *
        direction,
    )
  }, [connections, sorting, getRowSnapshot])

  const tableWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + column.size, 0),
    [visibleColumns],
  )
  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      updateViewport(event.currentTarget)
    },
    [updateViewport],
  )

  const bodyScrollTop = Math.max(0, viewport.scrollTop - ROW_HEIGHT)
  const firstVisibleRow = Math.min(
    sortedConnections.length,
    Math.max(0, Math.floor(bodyScrollTop / ROW_HEIGHT) - OVERSCAN_ROWS),
  )
  const lastVisibleRow = Math.max(
    firstVisibleRow,
    Math.min(
      sortedConnections.length,
      Math.ceil((bodyScrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN_ROWS,
    ),
  )
  const totalRowsHeight = sortedConnections.length * ROW_HEIGHT

  const toggleSorting = useCallback((field: ColumnField) => {
    setSorting((current) => {
      if (!current || current.id !== field) return { id: field, desc: false }
      if (!current.desc) return { id: field, desc: true }
      return null
    })
  }, [])

  const setColumnVisibility = useCallback(
    (field: ColumnField, visible: boolean) => {
      setColumnVisibilityModel((prev) => {
        const current = prev ?? {}
        const visibleCount = baseColumns.reduce((count, column) => {
          if (column.field === field) return count + (visible ? 1 : 0)
          return count + ((current[column.field] ?? true) !== false ? 1 : 0)
        }, 0)
        if (visibleCount === 0) return current

        const next: VisibilityState = {}
        baseColumns.forEach((column) => {
          if (column.field === field) {
            if (!visible) next[column.field] = false
          } else if (current[column.field] === false) {
            next[column.field] = false
          }
        })
        return next
      })
    },
    [baseColumns, setColumnVisibilityModel],
  )

  const handleManagerOrderChange = useCallback(
    (order: string[]) => {
      const baseFields = baseColumns.map((col) => col.field)
      setColumnOrder(reconcileColumnOrder(order, baseFields))
    },
    [baseColumns, setColumnOrder],
  )

  const handleResetColumns = useCallback(() => {
    setColumnVisibilityModel({})
    setColumnOrder(baseColumns.map((column) => column.field))
    setColumnWidths({})
    setSorting(null)
  }, [baseColumns, setColumnOrder, setColumnVisibilityModel, setColumnWidths])

  const managerColumns = useMemo<ConnectionColumnOption[]>(() => {
    return orderedColumns.map((column) => ({
      id: column.field,
      label: column.headerName,
      visible: (columnVisibilityModel?.[column.field] ?? true) !== false,
      toggleVisibility: (visible) => setColumnVisibility(column.field, visible),
    }))
  }, [columnVisibilityModel, orderedColumns, setColumnVisibility])

  const startResize = useCallback(
    (
      field: ColumnField,
      startClientX: number,
      startWidth: number,
      minWidth: number,
      maxWidth: number | undefined,
    ) => {
      const handleMove = (clientX: number) => {
        const nextWidth = Math.max(
          minWidth,
          startWidth + clientX - startClientX,
        )
        setColumnWidths((prev) => ({
          ...(prev ?? {}),
          [field]: maxWidth ? Math.min(maxWidth, nextWidth) : nextWidth,
        }))
      }

      const handleMouseMove = (event: MouseEvent) => handleMove(event.clientX)
      const handleTouchMove = (event: TouchEvent) => {
        const touch = event.touches[0]
        if (touch) handleMove(touch.clientX)
      }
      const cleanup = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', cleanup)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchend', cleanup)
        window.removeEventListener('touchcancel', cleanup)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', cleanup)
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', cleanup)
      window.addEventListener('touchcancel', cleanup)
    },
    [setColumnWidths],
  )

  const handleResizeMouseDown = useCallback(
    (column: DisplayColumn, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      startResize(
        column.field,
        event.clientX,
        column.size,
        column.minWidth,
        column.maxWidth,
      )
    },
    [startResize],
  )

  const handleResizeTouchStart = useCallback(
    (column: DisplayColumn, event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation()
      const touch = event.touches[0]
      if (!touch) return
      startResize(
        column.field,
        touch.clientX,
        column.size,
        column.minWidth,
        column.maxWidth,
      )
    },
    [startResize],
  )

  const borderColor = theme.palette.divider
  const headerBackground = theme.palette.background.paper
  const textSecondary = theme.palette.text.secondary

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          fontFamily: theme.typography.fontFamily,
        }}
      >
        <div
          ref={setScrollContainer}
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              minWidth: '100%',
              width: tableWidth,
            }}
          >
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  borderBottom: `1px solid ${borderColor}`,
                  backgroundColor: headerBackground,
                }}
              >
                {visibleColumns.map((column) => (
                  <div
                    key={column.field}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      position: 'relative',
                      boxSizing: 'border-box',
                      flex: `0 0 ${column.size}px`,
                      minWidth: column.minWidth,
                      maxWidth: column.maxWidth,
                      fontSize: 13,
                      fontWeight: 600,
                      color: textSecondary,
                      userSelect: 'none',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSorting(column.field)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent:
                          column.align === 'right' ? 'flex-end' : 'flex-start',
                        gap: 4,
                        padding: 8,
                        border: 0,
                        background: 'transparent',
                        color: 'inherit',
                        font: 'inherit',
                        textAlign: column.align === 'right' ? 'right' : 'left',
                        cursor: 'pointer',
                      }}
                    >
                      {column.headerName}
                      {sorting?.id === column.field
                        ? sorting.desc
                          ? '▼'
                          : '▲'
                        : null}
                    </button>
                    <div
                      onMouseDown={(event) =>
                        handleResizeMouseDown(column, event)
                      }
                      onTouchStart={(event) =>
                        handleResizeTouchStart(column, event)
                      }
                      style={{
                        cursor: 'col-resize',
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        width: RESIZE_HANDLE_WIDTH,
                        height: '100%',
                        transform: 'translateX(50%)',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                position: 'relative',
                height: totalRowsHeight,
              }}
            >
              {Array.from(
                { length: lastVisibleRow - firstVisibleRow },
                (_, offset) => {
                  const index = firstVisibleRow + offset
                  const row = sortedConnections[index]
                  if (!row) return null

                  return (
                    <RowComponent
                      key={row.id}
                      row={row}
                      columns={visibleColumns}
                      onShowDetail={onShowDetail}
                      getSnapshot={getRowSnapshot}
                      borderColor={borderColor}
                      virtualTop={index * ROW_HEIGHT}
                    />
                  )
                },
              )}
            </div>
          </div>
        </div>
      </div>
      <ConnectionColumnManager
        open={columnManagerOpen}
        columns={managerColumns}
        onClose={onCloseColumnManager}
        onOrderChange={handleManagerOrderChange}
        onReset={handleResetColumns}
      />
    </>
  )
}
