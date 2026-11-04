import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import DataUsageRoundedIcon from '@mui/icons-material/DataUsageRounded'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import {
  getTrafficSummary,
  queryTrafficStats,
  type TrafficAggregate,
  type TrafficSummary,
} from '@/services/cmds'
import { useQuery } from '@/services/query-client'
import parseTraffic from '@/utils/parse-traffic'

type GroupBy = 'domain' | 'process'
type TimeRange = 'today' | 'last7Days' | 'last30Days' | 'all'
type SortBy = 'download' | 'upload' | 'total' | 'connections'

function formatTraffic(bytes: number): string {
  const [value, unit] = parseTraffic(bytes)
  return `${value} ${unit}`
}

// Time bounds are computed inside the fetcher on every refresh: a mount-frozen
// `end` would permanently hide all records created after the page was opened.
function timeRangeStart(range: TimeRange): string | undefined {
  switch (range) {
    case 'today':
      return dayjs().startOf('day').toISOString()
    case 'last7Days':
      return dayjs().subtract(7, 'day').toISOString()
    case 'last30Days':
      return dayjs().subtract(30, 'day').toISOString()
    case 'all':
      return undefined
  }
}

export default function TrafficStatsPage() {
  const { t } = useTranslation()
  const [groupBy, setGroupBy] = useState<GroupBy>('domain')
  const [timeRange, setTimeRange] = useState<TimeRange>('today')
  const [sortBy, setSortBy] = useState<SortBy>('download')

  const aggregateQuery = useQuery<TrafficAggregate[]>({
    queryKey: ['traffic-stats', groupBy, timeRange],
    queryFn: () =>
      queryTrafficStats(
        timeRangeStart(timeRange) ?? null,
        dayjs().toISOString(),
        groupBy,
        100,
      ),
    refetchInterval: 5000,
  })

  const summaryQuery = useQuery<TrafficSummary>({
    queryKey: ['traffic-summary', timeRange],
    queryFn: () =>
      getTrafficSummary(
        timeRangeStart(timeRange) ?? null,
        dayjs().toISOString(),
      ),
    refetchInterval: 5000,
  })

  const isLoading = aggregateQuery.isLoading || summaryQuery.isLoading
  const isError = aggregateQuery.error != null || summaryQuery.error != null

  const sortedData = useMemo(() => {
    const rows = aggregateQuery.data ?? []
    return [...rows].sort((a, b) => {
      switch (sortBy) {
        case 'download':
          return b.total_download - a.total_download
        case 'upload':
          return b.total_upload - a.total_upload
        case 'total':
          return (
            b.total_upload +
            b.total_download -
            (a.total_upload + a.total_download)
          )
        case 'connections':
          return b.connection_count - a.connection_count
      }
    })
  }, [aggregateQuery.data, sortBy])

  return (
    <BasePage
      title={t('trafficStats.page.title')}
      header={<DataUsageRoundedIcon />}
    >
      <Grid container spacing={2}>
        {/* Overview */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t('trafficStats.summary.title')}
              </Typography>
              {summaryQuery.isLoading ? (
                <Skeleton variant="rectangular" height={80} />
              ) : (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
                    <StatCard
                      label={t('trafficStats.summary.totalUpload')}
                      value={formatTraffic(
                        summaryQuery.data?.total_upload ?? 0,
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
                    <StatCard
                      label={t('trafficStats.summary.totalDownload')}
                      value={formatTraffic(
                        summaryQuery.data?.total_download ?? 0,
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
                    <StatCard
                      label={t('trafficStats.summary.totalConnections')}
                      value={(
                        summaryQuery.data?.total_connections ?? 0
                      ).toLocaleString()}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
                    <StatCard
                      label={t('trafficStats.summary.uniqueDomains')}
                      value={(
                        summaryQuery.data?.unique_domains ?? 0
                      ).toLocaleString()}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
                    <StatCard
                      label={t('trafficStats.summary.uniqueProcesses')}
                      value={(
                        summaryQuery.data?.unique_processes ?? 0
                      ).toLocaleString()}
                    />
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Filters */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <ToggleButtonGroup
                  value={groupBy}
                  exclusive
                  onChange={(_, value) => value && setGroupBy(value)}
                  size="small"
                >
                  <ToggleButton value="domain">
                    <PublicRoundedIcon sx={{ mr: 1 }} fontSize="small" />
                    {t('trafficStats.filter.byDomain')}
                  </ToggleButton>
                  <ToggleButton value="process">
                    <AppsRoundedIcon sx={{ mr: 1 }} fontSize="small" />
                    {t('trafficStats.filter.byProcess')}
                  </ToggleButton>
                </ToggleButtonGroup>

                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>{t('trafficStats.filter.timeRange')}</InputLabel>
                  <Select
                    value={timeRange}
                    label={t('trafficStats.filter.timeRange')}
                    onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                  >
                    <MenuItem value="today">
                      {t('trafficStats.filter.today')}
                    </MenuItem>
                    <MenuItem value="last7Days">
                      {t('trafficStats.filter.last7Days')}
                    </MenuItem>
                    <MenuItem value="last30Days">
                      {t('trafficStats.filter.last30Days')}
                    </MenuItem>
                    <MenuItem value="all">
                      {t('trafficStats.filter.allTime')}
                    </MenuItem>
                  </Select>
                </FormControl>

                {isError && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" color="error">
                      {t('trafficStats.errors.loadFailed')}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() =>
                        void Promise.all([
                          aggregateQuery.refetch(),
                          summaryQuery.refetch(),
                        ])
                      }
                    >
                      {t('trafficStats.errors.retry')}
                    </Button>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Table */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>
                        {groupBy === 'domain'
                          ? t('trafficStats.table.domain')
                          : t('trafficStats.table.process')}
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'upload'}
                          direction="desc"
                          onClick={() => setSortBy('upload')}
                          hideSortIcon={sortBy !== 'upload'}
                        >
                          {t('trafficStats.table.upload')}
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'download'}
                          direction="desc"
                          onClick={() => setSortBy('download')}
                          hideSortIcon={sortBy !== 'download'}
                        >
                          {t('trafficStats.table.download')}
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'total'}
                          direction="desc"
                          onClick={() => setSortBy('total')}
                          hideSortIcon={sortBy !== 'total'}
                        >
                          {t('trafficStats.table.total')}
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'connections'}
                          direction="desc"
                          onClick={() => setSortBy('connections')}
                          hideSortIcon={sortBy !== 'connections'}
                        >
                          {t('trafficStats.table.connections')}
                        </TableSortLabel>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {isLoading ? (
                      ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'].map(
                        (row) => (
                          <TableRow key={row}>
                            <TableCell colSpan={6}>
                              <Skeleton />
                            </TableCell>
                          </TableRow>
                        ),
                      )
                    ) : sortedData.length > 0 ? (
                      sortedData.map((row, index) => (
                        <TableRow key={row.key} hover>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell
                            sx={{
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.key}
                          </TableCell>
                          <TableCell align="right">
                            {formatTraffic(row.total_upload)}
                          </TableCell>
                          <TableCell align="right">
                            {formatTraffic(row.total_download)}
                          </TableCell>
                          <TableCell align="right">
                            {formatTraffic(
                              row.total_upload + row.total_download,
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {row.connection_count.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography color="text.secondary" sx={{ py: 4 }}>
                            {isError
                              ? t('trafficStats.errors.loadFailed')
                              : t('trafficStats.table.noData')}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 1 }}
              >
                {t('trafficStats.footer.note')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </BasePage>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}
