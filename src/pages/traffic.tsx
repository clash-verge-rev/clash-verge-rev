import { SearchRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  InputAdornment,
  LinearProgress,
  TextField,
  Typography,
} from '@mui/material'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage } from '@/components/base'
import { useDailyTraffic } from '@/hooks/use-daily-traffic'
import parseTraffic from '@/utils/parse-traffic'

// ── SX constants matching ConnectionTable style ──

const SX_HEADER_ROW: React.ComponentProps<typeof Box>['sx'] = {
  display: 'flex',
  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
  backgroundColor: (theme) => theme.palette.background.paper,
}

const SX_HEADER_CELL: React.ComponentProps<typeof Box>['sx'] = {
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

const SX_CELL_CONTENT: React.ComponentProps<typeof Box>['sx'] = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  px: 1,
  py: 1,
}

const SX_DATA_CELL: React.ComponentProps<typeof Box>['sx'] = {
  boxSizing: 'border-box',
  px: 1.5,
  py: 0.75,
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const SX_ROW: React.ComponentProps<typeof Box>['sx'] = {
  display: 'flex',
  minHeight: 40,
  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
  '&:hover': {
    backgroundColor: (theme) => theme.palette.action.hover,
  },
}

// ── helpers ──

const TrafficShareCell = ({ ratio }: { ratio: number }) => (
  <Box
    sx={{
      width: '100%',
      height: 8,
      borderRadius: 4,
      bgcolor: (theme) => theme.palette.action.hover,
      overflow: 'hidden',
    }}
  >
    <Box
      sx={{
        height: '100%',
        width: `${Math.min(ratio * 100, 100)}%`,
        borderRadius: 4,
        bgcolor: (theme) => theme.palette.primary.main,
        transition: 'width 0.3s ease',
      }}
    />
  </Box>
)

// ── component ──

const TrafficPage = () => {
  const { t } = useTranslation()
  const { records, totalDownload, totalUpload, isLoading, clear } =
    useDailyTraffic()
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])

  const filtered = useMemo(() => {
    if (!search) return records
    const q = search.toLowerCase()
    return records.filter((r) => r.host.toLowerCase().includes(q))
  }, [records, search])

  // Enrich with computed share ratio
  const tableData = useMemo(
    () =>
      filtered.map((r) => ({
        ...r,
        share: totalDownload > 0 ? r.download / totalDownload : 0,
      })),
    [filtered, totalDownload],
  )

  const columns = useMemo<ColumnDef<(typeof tableData)[number]>[]>(
    () => [
      {
        id: 'host',
        accessorFn: (row) => row.host,
        header: t('traffic.components.columns.host'),
        size: 240,
        minSize: 140,
        cell: (ctx) => (
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {ctx.getValue() as string}
          </Typography>
        ),
      },
      {
        id: 'download',
        accessorFn: (row) => row.download,
        header: t('traffic.components.columns.download'),
        size: 120,
        minSize: 80,
        meta: { align: 'right' as const },
        cell: (ctx) => {
          const [v, u] = parseTraffic(ctx.getValue() as number)
          return <span style={{ fontWeight: 500 }}>{v} {u}</span>
        },
      },
      {
        id: 'upload',
        accessorFn: (row) => row.upload,
        header: t('traffic.components.columns.upload'),
        size: 120,
        minSize: 80,
        meta: { align: 'right' as const },
        cell: (ctx) => {
          const [v, u] = parseTraffic(ctx.getValue() as number)
          return <>{v} {u}</>
        },
      },
      {
        id: 'share',
        accessorFn: (row) => row.share,
        header: t('traffic.components.columns.trafficShare'),
        size: 160,
        minSize: 100,
        meta: { align: 'right' as const },
        cell: (ctx) => <TrafficShareCell ratio={ctx.getValue() as number} />,
      },
      {
        id: 'connections',
        accessorFn: (row) => row.connectionCount,
        header: t('traffic.components.columns.connections'),
        size: 100,
        minSize: 60,
        meta: { align: 'right' as const },
      },
      {
        id: 'lastActive',
        accessorFn: (row) => row.lastActive,
        header: t('traffic.components.columns.lastActive'),
        size: 120,
        minSize: 80,
        meta: { align: 'right' as const },
        cell: (ctx) => (
          <Typography variant="caption" color="text.secondary">
            {new Date(ctx.getValue() as number).toLocaleTimeString()}
          </Typography>
        ),
      },
    ],
    [t],
  )

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true,
    defaultColumn: { minSize: 60 },
  })

  const headerGroups = table.getHeaderGroups()
  const rows = table.getRowModel().rows

  if (isLoading) {
    return (
      <BasePage title={t('traffic.page.title')}>
        <LinearProgress />
      </BasePage>
    )
  }

  return (
    <BasePage
      title={t('traffic.page.title')}
      contentStyle={{ maxWidth: 1200, margin: '0 auto' }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
          <TextField
            size="small"
            placeholder={t('traffic.components.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ minWidth: 200 }}
          />
        </Box>
      }
    >
      {/* ── Summary bar ── */}
      <Box
        sx={{
          display: 'flex',
          gap: 3,
          mb: 2,
          px: 1,
          alignItems: 'center',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('traffic.components.totalDownload')}:{' '}
          <Typography
            component="span"
            color="primary"
            sx={{ fontWeight: 'bold' }}
          >
            {(() => {
              const [v, u] = parseTraffic(totalDownload)
              return `${v} ${u}`
            })()}
          </Typography>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('traffic.components.totalUpload')}:{' '}
          <Typography
            component="span"
            color="secondary"
            sx={{ fontWeight: 'bold' }}
          >
            {(() => {
              const [v, u] = parseTraffic(totalUpload)
              return `${v} ${u}`
            })()}
          </Typography>
        </Typography>
        <Box sx={{ ml: 'auto' }}>
          <Button
            variant="outlined"
            size="small"
            color="error"
            onClick={clear}
          >
            {t('traffic.components.clear')}
          </Button>
        </Box>
      </Box>

      {/* ── Table ── */}
      {rows.length === 0 ? (
        <Box sx={{ mt: 4 }}>
          <BaseEmpty text={t('traffic.components.emptyText')} />
        </Box>
      ) : (
        <Box
          sx={{
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          {headerGroups.map((headerGroup) => (
            <Box key={headerGroup.id} sx={SX_HEADER_ROW}>
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as
                  | { align?: 'left' | 'right' }
                  | undefined
                return (
                  <Box
                    key={header.id}
                    sx={[
                      SX_HEADER_CELL,
                      {
                        flex: `0 0 ${header.getSize()}px`,
                        minWidth: header.column.columnDef.minSize ?? 60,
                      },
                    ]}
                  >
                    <Box
                      onClick={header.column.getToggleSortingHandler()}
                      sx={[
                        SX_CELL_CONTENT,
                        {
                          justifyContent:
                            meta?.align === 'right'
                              ? 'flex-end'
                              : 'flex-start',
                          cursor: 'pointer',
                        },
                      ]}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {{
                        asc: ' ▲',
                        desc: ' ▼',
                      }[header.column.getIsSorted() as string] ?? null}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          ))}

          {/* Body */}
          {rows.map((row) => (
            <Box key={row.id} sx={SX_ROW}>
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as
                  | { align?: 'left' | 'right' }
                  | undefined
                return (
                  <Box
                    key={cell.id}
                    sx={[
                      SX_DATA_CELL,
                      {
                        flex: `0 0 ${cell.column.getSize()}px`,
                        minWidth: cell.column.columnDef.minSize ?? 60,
                        justifyContent:
                          meta?.align === 'right'
                            ? 'flex-end'
                            : 'flex-start',
                      },
                    ]}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      )}
    </BasePage>
  )
}

export default TrafficPage
