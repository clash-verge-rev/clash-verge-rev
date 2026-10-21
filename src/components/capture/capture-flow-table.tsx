import {
  ContentCopyRounded,
  KeyboardArrowDownRounded,
} from '@mui/icons-material'
import {
  Autocomplete,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

import { BaseStyledTextField } from '@/components/base'
import type {
  CaptureDomainCount,
  CaptureFlow,
  CaptureFlowList,
  CaptureQuery,
} from '@/services/capture'
import { contentTypeKind } from '@/utils/capture-inspectors'

import { CaptureCard } from './capture-card'

interface Props {
  flows: CaptureFlowList
  domains: CaptureDomainCount[]
  query: CaptureQuery
  onQueryChange: (next: Partial<CaptureQuery>) => void
  onOpen: (id: string) => void
  onCopy: (id: string) => void
  onClear: (domain: string) => void
}

const statusColor = (flow: CaptureFlow) => {
  if (flow.error || flow.status >= 400) return 'error.main'
  return flow.status ? 'success.main' : 'warning.main'
}

const formatTime = (unix: number) => {
  const date = new Date(unix * 1000)
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

interface FilterSelectProps {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}

const CONTROL_HEIGHT = 33

/** GitHub-style facet filter: a plain "label value ▾" dropdown. */
const FilterSelect = ({
  label,
  value,
  options,
  onChange,
}: FilterSelectProps) => (
  <TextField
    select
    variant="standard"
    value={value}
    aria-label={label}
    onChange={(event) => onChange(event.target.value)}
    slotProps={{
      input: {
        disableUnderline: true,
        startAdornment: (
          <InputAdornment position="start">
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {label}
            </Typography>
          </InputAdornment>
        ),
        sx: { fontSize: 13 },
      },
      select: { IconComponent: KeyboardArrowDownRounded },
    }}
    sx={{
      width: 'auto',
      minWidth: 0,
      '& .MuiSelect-select': { py: 0.5, pl: 0.5, pr: '22px !important' },
    }}
  >
    {options.map((option) => (
      <MenuItem key={option.value} value={option.value}>
        {option.label}
      </MenuItem>
    ))}
  </TextField>
)

export const CaptureFlowTable = ({
  flows,
  domains,
  query,
  onQueryChange,
  onOpen,
  onCopy,
  onClear,
}: Props) => {
  const { t } = useTranslation()
  const { items, page, pages, total } = flows

  const statusOptions = [
    { value: '', label: t('layout.capture.statusAll') },
    { value: 'success', label: t('layout.capture.statusSuccess') },
    { value: 'redirect', label: t('layout.capture.statusRedirect') },
    { value: 'client', label: t('layout.capture.statusClient') },
    { value: 'server', label: t('layout.capture.statusServer') },
    { value: 'error', label: t('layout.capture.statusError') },
    { value: 'failed', label: t('layout.capture.statusFailed') },
  ]
  const typeOptions = [
    { value: '', label: t('layout.capture.typeAll') },
    { value: 'html', label: t('layout.capture.typeHtml') },
    { value: 'json', label: t('layout.capture.typeJson') },
    { value: 'image', label: t('layout.capture.typeImage') },
    { value: 'script', label: t('layout.capture.typeScript') },
    { value: 'css', label: t('layout.capture.typeCss') },
    { value: 'font', label: t('layout.capture.typeFont') },
    { value: 'other', label: t('layout.capture.typeOther') },
  ]
  const methodOptions = [
    { value: '', label: t('layout.capture.methodAll') },
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(
      (value) => ({
        value,
        label: value,
      }),
    ),
    { value: 'OTHER', label: t('layout.capture.methodOther') },
  ]

  const typeLabels: Record<string, string> = {
    html: t('layout.capture.typeHtml'),
    json: t('layout.capture.typeJson'),
    image: t('layout.capture.typeImage'),
    script: t('layout.capture.typeScript'),
    css: t('layout.capture.typeCss'),
    font: t('layout.capture.typeFont'),
    other: t('layout.capture.typeOther'),
  }

  return (
    <CaptureCard>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1 }}
      >
        <BaseStyledTextField
          sx={{ flex: 1, minWidth: 200 }}
          value={query.search}
          onChange={(event) =>
            onQueryChange({ page: 1, search: event.target.value })
          }
          placeholder={t('layout.capture.searchPlaceholder')}
        />
        <Autocomplete
          size="small"
          sx={{
            minWidth: 220,
            '& .MuiInputBase-root': { height: CONTROL_HEIGHT },
          }}
          slotProps={{ paper: { sx: { minWidth: 360 } } }}
          options={domains.map((item) => item.domain)}
          value={query.domain || null}
          onChange={(_, value) =>
            onQueryChange({ page: 1, domain: value ?? '' })
          }
          renderOption={({ key, ...props }, option) => {
            const item = domains.find((domain) => domain.domain === option)
            return (
              <li key={String(key)} {...props} style={{ whiteSpace: 'nowrap' }}>
                {option} ({item?.count ?? 0})
              </li>
            )
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('layout.capture.allDomains')}
              aria-label={t('layout.capture.allDomains')}
            />
          )}
          noOptionsText={t('layout.capture.noResults')}
        />
        <Button
          size="small"
          color="error"
          variant="outlined"
          disabled={!query.domain}
          onClick={() => onClear(query.domain)}
        >
          {t('layout.capture.clearDomain')}
        </Button>
        <Button
          size="small"
          color="error"
          variant="outlined"
          onClick={() => onClear('')}
        >
          {t('layout.capture.clearAll')}
        </Button>
      </Stack>

      <Stack
        direction="row"
        spacing={2.5}
        useFlexGap
        sx={{
          flexWrap: 'wrap',
          alignItems: 'center',
          mt: 1,
          px: 0.5,
          py: 0.25,
          borderRadius: 1,
          bgcolor: 'action.hover',
        }}
      >
        <FilterSelect
          label={t('layout.capture.filterMethod')}
          value={query.method}
          options={methodOptions}
          onChange={(method) => onQueryChange({ page: 1, method })}
        />
        <FilterSelect
          label={t('layout.capture.filterType')}
          value={query.type}
          options={typeOptions}
          onChange={(type) => onQueryChange({ page: 1, type })}
        />
        <FilterSelect
          label={t('layout.capture.filterStatus')}
          value={query.status}
          options={statusOptions}
          onChange={(status) => onQueryChange({ page: 1, status })}
        />
      </Stack>

      <Table size="small" sx={{ mt: 1, tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <TableCell width={110}>{t('layout.capture.method')}</TableCell>
            <TableCell>{t('layout.capture.url')}</TableCell>
            <TableCell width={112}>{t('layout.capture.time')}</TableCell>
            <TableCell width={110}>{t('layout.capture.contentType')}</TableCell>
            <TableCell width={130}>{t('layout.capture.status')}</TableCell>
            <TableCell width={64} align="right">
              {t('layout.capture.actions')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.length ? (
            items.map((flow) => {
              const kind = contentTypeKind(flow.content_type)
              return (
                <TableRow key={flow.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {flow.method}
                  </TableCell>
                  <TableCell sx={{ minWidth: 0 }}>
                    <Typography
                      component="button"
                      onClick={() => onOpen(flow.id)}
                      sx={{
                        width: '100%',
                        border: 0,
                        p: 0,
                        font: 'inherit',
                        color: 'primary.main',
                        textAlign: 'left',
                        cursor: 'pointer',
                        background: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {flow.url}
                    </Typography>
                  </TableCell>
                  <TableCell
                    sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                    title={new Date(flow.time * 1000).toLocaleString()}
                  >
                    {formatTime(flow.time)}
                  </TableCell>
                  <TableCell>{kind ? typeLabels[kind] : '—'}</TableCell>
                  <TableCell sx={{ color: statusColor(flow) }}>
                    {flow.error
                      ? t('layout.capture.failed')
                      : flow.status || t('layout.capture.pending')}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('layout.capture.copyCurl')}>
                      <IconButton size="small" onClick={() => onCopy(flow.id)}>
                        <ContentCopyRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })
          ) : (
            <TableRow>
              <TableCell
                colSpan={6}
                align="center"
                sx={{ py: 4, color: 'text.secondary' }}
              >
                {t('layout.capture.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Typography variant="caption" color="text.secondary">
        {t('layout.capture.retentionHint', {
          limit: flows.retained_limit ?? 1000,
          dropped: flows.dropped ?? 0,
        })}
      </Typography>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 1 }}
      >
        <Typography variant="caption" color="text.secondary">
          {total
            ? t('layout.capture.resultCount', { total, count: items.length })
            : t('layout.capture.noResults')}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            disabled={page <= 1}
            onClick={() => onQueryChange({ page: page - 1 })}
          >
            {t('layout.capture.prevPage')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t('layout.capture.pageInfo', { page, pages })}
          </Typography>
          <Button
            size="small"
            disabled={page >= pages}
            onClick={() => onQueryChange({ page: page + 1 })}
          >
            {t('layout.capture.nextPage')}
          </Button>
        </Stack>
      </Stack>
    </CaptureCard>
  )
}
