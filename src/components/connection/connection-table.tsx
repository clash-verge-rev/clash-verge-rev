import { Box } from '@mui/material'
import {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  Row,
  SortingState,
  Updater,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import dayjs from 'dayjs'
import { useLocalStorage } from 'foxact/use-local-storage'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import parseTraffic from '@/utils/parse-traffic'
import { truncateStr } from '@/utils/truncate-str'

import { ConnectionColumnManager } from './connection-column-manager'

const ROW_HEIGHT = 40

type TickListener = () => void
let _tickNow = Date.now()
const _tickListeners = new Set<TickListener>()
let _tickTimer: ReturnType<typeof setInterval> | null = null

const _startTick = () => {
  if (_tickTimer !== null) return
  _tickTimer = setInterval(() => {
    _tickNow = Date.now()
    _tickListeners.forEach((fn) => fn())
  }, 5000)
}

const _stopTick = () => {
  if (_tickListeners.size === 0 && _tickTimer !== null) {
    clearInterval(_tickTimer)
    _tickTimer = null
  }
}

const tickStore = {
  subscribe: (listener: TickListener) => {
    _tickListeners.add(listener)
    _startTick()
    return () => {
      _tickListeners.delete(listener)
      _stopTick()
    }
  },
  getSnapshot: () => _tickNow,
}

interface RelativeTimeCellProps {
  start: string
}

const RelativeTimeCell = memo(function RelativeTimeCell({
  start,
}: RelativeTimeCellProps) {
  const now = useSyncExternalStore(tickStore.subscribe, tickStore.getSnapshot)
  return <>{dayjs(start).from(now)}</>
})

const SX_OUTER: React.ComponentProps<typeof Box>['sx'] = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  position: 'relative',
  fontFamily: (theme) => theme.typography.fontFamily,
}

const SX_SCROLL_CONTAINER: React.ComponentProps<typeof Box>['sx'] = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  WebkitOverflowScrolling: 'touch',
  overscrollBehavior: 'contain',
  borderRadius: 1,
  border: 'none',
  '&::-webkit-scrollbar': {
    height: 8,
  },
}

const SX_HEADER_STICKY: React.ComponentProps<typeof Box>['sx'] = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
}

const SX_CELL_CONTENT: React.ComponentProps<typeof Box>['sx'] = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  px: 1,
  py: 1,
}

const SX_RESIZE_HANDLE: React.ComponentProps<typeof Box>['sx'] = {
  cursor: 'col-resize',
  position: 'absolute',
  right: 0,
  top: 0,
  width: 4,
  height: '100%',
  transform: 'translateX(50%)',
  '&:hover': {
    backgroundColor: (theme) => theme.palette.action.active,
  },
}

const SX_HEADER_ROW: React.ComponentProps<typeof Box>['sx'] = {
  display: 'flex',
  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
  backgroundColor: (theme) => theme.palette.background.paper,
}

const SX_HEADER_CELL_BASE: React.ComponentProps<typeof Box>['sx'] = {
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
  boxSizing: 'border-box',
  fontSize: 13,
  fontWeight: 600,
  color: 'text.secondary',
  userSelect: 'none',
  '&:hover': {
    backgroundColor: (theme) => theme.palette.action.hover,
  },
}

const SX_DATA_CELL_BASE: React.ComponentProps<typeof Box>['sx'] = {
  boxSizing: 'border-box',
  px: 1,
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const SX_ROW_BASE: React.ComponentProps<typeof Box>['sx'] = {
  display: 'flex',
  position: 'absolute',
  left: 0,
  right: 0,
  cursor: 'pointer',
  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
  '&:hover': {
    backgroundColor: (theme) => theme.palette.action.hover,
  },
}

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

const getConnectionCellValue = (field: ColumnField, each: IConnectionsItem) => {
  const { metadata, rulePayload } = each

  switch (field) {
    case 'host':
      return metadata.host
        ? `${metadata.host}:${metadata.destinationPort}`
        : `${metadata.remoteDestination}:${metadata.destinationPort}`
    case 'download':
      return each.download
    case 'upload':
      return each.upload
    case 'dlSpeed':
      return each.curDownload
    case 'ulSpeed':
      return each.curUpload
    case 'chains':
      return [...each.chains].reverse().join(' / ')
    case 'rule':
      return rulePayload ? `${each.rule}(${rulePayload})` : each.rule
    case 'process':
      return truncateStr(metadata.process || metadata.processPath)
    case 'time':
      return each.start
    case 'source':
      return `${metadata.sourceIP}:${metadata.sourcePort}`
    case 'remoteDestination':
      return metadata.destinationIP
        ? `${metadata.destinationIP}:${metadata.destinationPort}`
        : `${metadata.remoteDestination}:${metadata.destinationPort}`
    case 'type':
      return `${metadata.type}(${metadata.network})`
    default:
      return ''
  }
}

interface RowComponentProps {
  row: Row<IConnectionsItem>
  virtualStart: number
  virtualSize: number
  onShowDetail: (data: IConnectionsItem) => void
}

const RowComponent = memo(
  function RowComponent({
    row,
    virtualStart,
    virtualSize,
    onShowDetail,
  }: RowComponentProps) {
    const handleClick = useCallback(
      () => onShowDetail(row.original),
      [onShowDetail, row.original],
    )

    return (
      <Box
        sx={[
          SX_ROW_BASE,
          {
            height: virtualSize,
            transform: `translateY(${virtualStart}px)`,
          },
        ]}
        onClick={handleClick}
      >
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta as {
            align?: 'left' | 'right'
          }
          return (
            <Box
              key={cell.id}
              sx={[
                SX_DATA_CELL_BASE,
                {
                  flex: `0 0 ${cell.column.getSize()}px`,
                  minWidth: cell.column.columnDef.minSize ?? 80,
                  maxWidth: cell.column.columnDef.maxSize,
                  justifyContent:
                    meta?.align === 'right' ? 'flex-end' : 'flex-start',
                },
              ]}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </Box>
          )
        })}
      </Box>
    )
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize &&
    prev.onShowDetail === next.onShowDetail,
)

interface Props {
  connections: IConnectionsItem[]
  onShowDetail: (data: IConnectionsItem) => void
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
    (data: IConnectionsItem) => onShowDetailRef.current(data),
    [],
  )
  const { t } = useTranslation()
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

  interface BaseColumn {
    field: ColumnField
    headerName: string
    width?: number
    minWidth?: number
    align?: 'left' | 'right'
    cell?: (row: IConnectionsItem) => ReactNode
  }

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
        cell: (row) => parseTraffic(row.download).join(' '),
      },
      {
        field: 'upload',
        headerName: t('shared.labels.uploaded'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (row) => parseTraffic(row.upload).join(' '),
      },
      {
        field: 'dlSpeed',
        headerName: t('connections.components.fields.dlSpeed'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (row) => `${parseTraffic(row.curDownload).join(' ')}/s`,
      },
      {
        field: 'ulSpeed',
        headerName: t('connections.components.fields.ulSpeed'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (row) => `${parseTraffic(row.curUpload).join(' ')}/s`,
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

  const handleColumnVisibilityChange = useCallback(
    (update: Updater<VisibilityState>) => {
      setColumnVisibilityModel((prev) => {
        const current = prev ?? {}
        const nextState =
          typeof update === 'function' ? update(current) : update

        const visibleCount = baseColumns.reduce((count, column) => {
          const isVisible = (nextState[column.field] ?? true) !== false
          return count + (isVisible ? 1 : 0)
        }, 0)

        if (visibleCount === 0) {
          return current
        }

        const sanitized: VisibilityState = {}
        baseColumns.forEach((column) => {
          if (nextState[column.field] === false) {
            sanitized[column.field] = false
          }
        })
        return sanitized
      })
    },
    [baseColumns, setColumnVisibilityModel],
  )

  const handleColumnOrderChange = useCallback(
    (update: Updater<ColumnOrderState>) => {
      setColumnOrder((prev) => {
        const current = Array.isArray(prev) ? prev : []
        const nextState =
          typeof update === 'function' ? update(current) : update
        const baseFields = baseColumns.map((col) => col.field)
        return reconcileColumnOrder(nextState, baseFields)
      })
    },
    [baseColumns, setColumnOrder],
  )

  const [sorting, setSorting] = useState<SortingState>([])

  // columnDefs no longer depends on relativeNow — time column delegates to RelativeTimeCell
  const columnDefs = useMemo<ColumnDef<IConnectionsItem>[]>(() => {
    return baseColumns.map((column) => {
      let cell: ColumnDef<IConnectionsItem>['cell']
      if (column.field === 'time') {
        cell = (ctx) => <RelativeTimeCell start={ctx.row.original.start} />
      } else if (column.cell) {
        const renderCell = column.cell
        cell = (ctx) => renderCell(ctx.row.original)
      } else {
        cell = (ctx) =>
          ctx.row.original
            ? (getConnectionCellValue(
                column.field,
                ctx.row.original,
              ) as ReactNode)
            : null
      }

      return {
        id: column.field,
        accessorFn: (row) => getConnectionCellValue(column.field, row),
        header: column.headerName,
        size: column.width,
        minSize: column.minWidth,
        meta: {
          align: column.align ?? 'left',
          field: column.field,
          label: column.headerName,
        },
        cell,
      } satisfies ColumnDef<IConnectionsItem>
    })
  }, [baseColumns])

  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnWidths((prev) => {
        const prevState = prev ?? {}
        const nextState =
          typeof updater === 'function' ? updater(prevState) : updater
        const sanitized: ColumnSizingState = {}
        Object.entries(nextState).forEach(([key, size]) => {
          if (typeof size === 'number' && Number.isFinite(size)) {
            sanitized[key] = size
          }
        })
        return sanitized
      })
    },
    [setColumnWidths],
  )

  const table = useReactTable({
    data: connections,
    state: {
      columnVisibility: columnVisibilityModel ?? {},
      columnSizing: columnWidths,
      columnOrder,
      sorting,
    },
    initialState: {
      columnOrder: baseColumns.map((col) => col.field),
    },
    defaultColumn: {
      minSize: 80,
      enableResizing: true,
    },
    columnResizeMode: 'onChange',
    enableSortingRemoval: true,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sorting.length ? getSortedRowModel() : undefined,
    onSortingChange: setSorting,
    onColumnSizingChange: handleColumnSizingChange,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onColumnOrderChange: handleColumnOrderChange,
    columns: columnDefs,
  })

  const handleManagerOrderChange = useCallback(
    (order: string[]) => {
      const baseFields = baseColumns.map((col) => col.field)
      table.setColumnOrder(reconcileColumnOrder(order, baseFields))
    },
    [baseColumns, table],
  )

  const handleResetColumns = useCallback(() => {
    table.resetColumnVisibility()
    table.resetColumnOrder()
  }, [table])

  const rows = table.getRowModel().rows
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const tableWidth = table.getTotalSize()
  const managerColumns = table.getAllLeafColumns()

  return (
    <>
      <Box sx={SX_OUTER}>
        <Box ref={tableContainerRef} sx={SX_SCROLL_CONTAINER}>
          <Box
            sx={{
              minWidth: '100%',
              width: tableWidth,
            }}
          >
            <Box sx={SX_HEADER_STICKY}>
              {table.getHeaderGroups().map((headerGroup) => (
                <Box key={headerGroup.id} sx={SX_HEADER_ROW}>
                  {headerGroup.headers.map((header) => {
                    if (header.isPlaceholder) {
                      return null
                    }
                    const meta = header.column.columnDef.meta as {
                      align?: 'left' | 'right'
                      field: string
                    }
                    return (
                      <Box
                        key={header.id}
                        sx={[
                          SX_HEADER_CELL_BASE,
                          {
                            flex: `0 0 ${header.getSize()}px`,
                            minWidth: header.column.columnDef.minSize ?? 80,
                            maxWidth: header.column.columnDef.maxSize,
                          },
                        ]}
                      >
                        <Box
                          component="span"
                          onClick={
                            header.column.getCanSort()
                              ? header.column.getToggleSortingHandler()
                              : undefined
                          }
                          sx={[
                            SX_CELL_CONTENT,
                            {
                              justifyContent:
                                meta?.align === 'right'
                                  ? 'flex-end'
                                  : 'flex-start',
                              cursor: header.column.getCanSort()
                                ? 'pointer'
                                : 'default',
                            },
                          ]}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {{
                            asc: '▲',
                            desc: '▼',
                          }[header.column.getIsSorted() as string] ?? null}
                        </Box>
                        {header.column.getCanResize() && (
                          <Box
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => {
                              event.stopPropagation()
                              header.getResizeHandler()(event)
                            }}
                            onTouchStart={(event) => {
                              event.stopPropagation()
                              header.getResizeHandler()(event)
                            }}
                            sx={SX_RESIZE_HANDLE}
                          />
                        )}
                      </Box>
                    )
                  })}
                </Box>
              ))}
            </Box>
            <Box
              sx={{
                position: 'relative',
                height: totalSize,
              }}
            >
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index]
                if (!row) return null

                return (
                  <RowComponent
                    key={row.id}
                    row={row}
                    virtualStart={virtualRow.start}
                    virtualSize={virtualRow.size}
                    onShowDetail={onShowDetail}
                  />
                )
              })}
            </Box>
          </Box>
        </Box>
      </Box>
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
