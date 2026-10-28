import {
  CheckRounded,
  GppMaybeOutlined,
  RemoveRounded,
  WarningAmberRounded,
} from '@mui/icons-material'
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useDnsLeak } from '@/hooks/use-dns-leak'
import { useIpAssessment } from '@/hooks/use-ip-assessment'
import { useWebrtcLeak } from '@/hooks/use-webrtc-leak'
import {
  RISK_CHECK_GROUPS,
  groupAssessmentValues,
  type IpAssessment,
} from '@/services/ip-assessment'
import { getDnsLeakStatus, getWebrtcLeakState } from '@/utils/ip-leak-state'

import { AssessmentTooltip, IpPanelTitle } from './ip-assessment-panel'

const EMPTY = '—'

const Metric = ({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: ReactNode
  note?: string
  tone?: 'warning.main' | 'success.main'
}) => (
  <Box
    sx={{
      p: 1.25,
      borderRadius: 1.5,
      bgcolor: 'action.hover',
      minWidth: 0,
    }}
  >
    <Typography variant="caption" color="text.secondary" noWrap component="div">
      {label}
    </Typography>
    <Typography
      sx={{
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums',
        color: tone,
      }}
      component="div"
    >
      {value}
    </Typography>
    {note && (
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        component="div"
        title={note}
      >
        {note}
      </Typography>
    )}
  </Box>
)

const CheckChip = ({
  label,
  value,
}: {
  label: string
  value: boolean | null
}) => (
  <Chip
    size="small"
    variant="outlined"
    color={value === true ? 'warning' : value === false ? 'success' : 'default'}
    icon={
      value === true ? (
        <WarningAmberRounded />
      ) : value === false ? (
        <CheckRounded />
      ) : (
        <RemoveRounded />
      )
    }
    label={label}
    sx={value === null ? { borderStyle: 'dashed', opacity: 0.6 } : undefined}
  />
)

const useWebrtcState = (egressIps: string[]) => {
  const { data, isLoading, error } = useWebrtcLeak()
  if (isLoading) return { state: 'checking' as const, leaked: [] }
  if (error || data === undefined)
    return { state: 'unknown' as const, leaked: [] }
  if (data === null) return { state: 'unsupported' as const, leaked: [] }
  return getWebrtcLeakState(data, egressIps)
}

// Resolvers outside the exit country point to lookups bypassing the proxy; anycast can blur this.
const useDnsState = () => {
  const { data, isLoading, error } = useDnsLeak()
  if (isLoading)
    return { state: 'checking' as const, countries: [], servers: 0 }
  if (error) return { state: 'failed' as const, countries: [], servers: 0 }
  if (!data) return { state: 'unknown' as const, countries: [], servers: 0 }
  const countries = [
    ...new Set(data.servers.map((server) => server.country).filter(Boolean)),
  ]
  return {
    state: getDnsLeakStatus(
      data.exitCountry,
      data.servers.map((server) => server.country),
    ),
    countries,
    servers: data.servers.length,
  }
}

export const IpRiskPanel = ({ egressIp }: { egressIp?: string }) => {
  const { t } = useTranslation()
  const { data } = useIpAssessment()
  const webrtc = useWebrtcState(
    [egressIp, ...(data ?? []).map((result) => result.ip)].filter(
      (ip): ip is string => !!ip,
    ),
  )
  const dns = useDnsState()
  const results = data ?? []
  const fmt = (value: number | null | undefined, key?: string) =>
    value == null ? EMPTY : key ? t(key, { count: value }) : value

  const metricValue = (
    select: (result: IpAssessment) => string | number | null,
    format: (value: string | number) => ReactNode = (value) => value,
  ) => (
    <Stack spacing={0.5}>
      {groupAssessmentValues(results, select).map(({ value, sources }) => (
        <AssessmentTooltip key={value ?? 'unknown'} sources={sources}>
          <Box
            component="span"
            tabIndex={0}
            sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}
          >
            {value === null ? EMPTY : format(value)}
          </Box>
        </AssessmentTooltip>
      ))}
    </Stack>
  )

  return (
    <Stack spacing={1.5} sx={{ mt: 3 }}>
      <IpPanelTitle
        icon={<GppMaybeOutlined fontSize="small" />}
        color="primary"
        title={t('home.network.risk.title')}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(4, minmax(0, 1fr))',
            lg: 'repeat(8, minmax(0, 1fr))',
          },
          gap: 1,
        }}
      >
        <Metric
          label={t('home.network.risk.metrics.proxyRisk')}
          value={metricValue(({ metrics }) =>
            metrics.proxyRisk == null ? null : `${metrics.proxyRisk} / 100`,
          )}
        />
        <Metric
          label={t('home.network.risk.metrics.sharedDevices')}
          value={metricValue(({ metrics }) =>
            metrics.sharedDevices == null
              ? null
              : fmt(metrics.sharedDevices, 'home.network.risk.units.devices'),
          )}
        />
        <Metric
          label={t('home.network.risk.metrics.networkAbuse')}
          value={metricValue(
            ({ metrics }) => metrics.networkAbuse,
            (value) =>
              Number(value).toLocaleString(undefined, {
                style: 'percent',
                maximumFractionDigits: 8,
              }),
          )}
        />
        <Metric
          label="DNSBL"
          value={metricValue(({ metrics }) =>
            metrics.dnsbl == null
              ? null
              : fmt(metrics.dnsbl, 'home.network.risk.units.entries'),
          )}
        />
        <Metric
          label={t('home.network.risk.metrics.publicLists')}
          value={metricValue(({ metrics }) =>
            metrics.publicLists == null
              ? null
              : fmt(metrics.publicLists, 'home.network.risk.units.lists'),
          )}
        />
        <Metric
          label={t('home.network.risk.metrics.reports')}
          value={metricValue(({ metrics }) =>
            metrics.reports == null
              ? null
              : `${fmt(metrics.reports, 'home.network.risk.units.entries')}${metrics.reportDays ? `\n${t('home.network.risk.metrics.reportsDays', { days: metrics.reportDays })}` : ''}`,
          )}
        />
        <Metric
          label={t('home.network.risk.metrics.webrtc')}
          value={
            <Tooltip title="WebRTC · Google / Cloudflare STUN" describeChild>
              <Box component="span" tabIndex={0}>
                {t(`home.network.risk.webrtc.${webrtc.state}`)}
              </Box>
            </Tooltip>
          }
          tone={
            webrtc.state === 'leak'
              ? 'warning.main'
              : webrtc.state === 'safe' || webrtc.state === 'blocked'
                ? 'success.main'
                : undefined
          }
          note={webrtc.leaked.join(', ') || undefined}
        />
        <Metric
          label={t('home.network.risk.metrics.dns')}
          value={
            <Tooltip title="bash.ws" describeChild>
              <Box component="span" tabIndex={0}>
                {t(`home.network.risk.dns.${dns.state}`)}
              </Box>
            </Tooltip>
          }
          tone={
            dns.state === 'mismatch'
              ? 'warning.main'
              : dns.state === 'safe'
                ? 'success.main'
                : undefined
          }
          note={
            dns.servers
              ? `${dns.countries.join(', ')} · ${t('home.network.risk.dns.servers', { count: dns.servers })}`
              : undefined
          }
        />
      </Box>
    </Stack>
  )
}

export const IpRiskChecksPanel = () => {
  const { t } = useTranslation()
  const { data } = useIpAssessment()
  const results = data ?? []
  const values = Object.values(RISK_CHECK_GROUPS)
    .flat()
    .map((id) => {
      const reported = results.map((result) => result.checks[id])
      return reported.includes(true)
        ? true
        : reported.includes(false)
          ? false
          : null
    })

  return (
    <Stack
      spacing={1}
      sx={{
        minWidth: 0,
        '& .MuiTypography-caption': { fontSize: 11 },
        '& .MuiChip-root': {
          fontSize: 11,
          height: 20,
          '& .MuiChip-icon': { fontSize: 14 },
        },
      }}
    >
      <IpPanelTitle
        icon={<GppMaybeOutlined fontSize="small" />}
        color="primary"
        title={t('home.network.detection')}
      />
      <Tooltip title={t('home.network.risk.legend')} describeChild>
        <Typography
          variant="caption"
          color="text.secondary"
          tabIndex={0}
          sx={{
            minHeight: 36,
            display: 'flex',
            alignItems: 'center',
            cursor: 'help',
          }}
        >
          {t('home.network.risk.summary', {
            hit: values.filter((value) => value === true).length,
            clear: values.filter((value) => value === false).length,
            unknown: values.filter((value) => value === null).length,
          })}
        </Typography>
      </Tooltip>
      {(
        Object.keys(RISK_CHECK_GROUPS) as (keyof typeof RISK_CHECK_GROUPS)[]
      ).map((group) => {
        const ids = RISK_CHECK_GROUPS[group]
        const known = ids.filter((id) =>
          results.some((result) => result.checks[id] !== null),
        )
        const hits = ids.filter((id) =>
          results.some((result) => result.checks[id] === true),
        )
        return (
          <Stack
            key={group}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'flex-start' }}
          >
            <Box sx={{ width: 52, flexShrink: 0, pt: 0.25 }}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, fontSize: 12 }}
              >
                {t(`home.network.risk.groups.${group}`)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {known.length ? `${hits.length} / ${known.length}` : EMPTY}
              </Typography>
            </Box>
            <Box
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}
            >
              {ids.flatMap((id) => {
                const groups = groupAssessmentValues(
                  results,
                  (result) => result.checks[id],
                )
                return groups.map(({ value, sources }) => (
                  <AssessmentTooltip key={`${id}-${value}`} sources={sources}>
                    <Box
                      component="span"
                      tabIndex={0}
                      sx={{ display: 'inline-flex' }}
                    >
                      <CheckChip
                        label={`${t(`home.network.risk.checks.${id}`)}${groups.length > 1 ? ` · ${t(value ? 'home.network.yes' : 'home.network.no')}` : ''}`}
                        value={value}
                      />
                    </Box>
                  </AssessmentTooltip>
                ))
              })}
            </Box>
          </Stack>
        )
      })}
    </Stack>
  )
}
