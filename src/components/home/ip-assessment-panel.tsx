import { CheckCircleOutlineRounded, ShieldOutlined } from '@mui/icons-material'
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useIpAssessment } from '@/hooks/use-ip-assessment'
import {
  groupAssessmentValues,
  type IpAssessment,
} from '@/services/ip-assessment'
import {
  getIpRiskColor,
  getNetworkTypeColor,
} from '@/utils/ip-assessment-display'

const FLAG_NAMES = ['proxy', 'vpn', 'tor', 'datacenter', 'abuser'] as const

export const IpPanelTitle = ({
  icon,
  color,
  title,
}: {
  icon: ReactNode
  color: 'primary' | 'success' | 'info'
  title: string
}) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
    <Box
      sx={(theme) => ({
        display: 'flex',
        p: 0.5,
        borderRadius: 1,
        color: `${color}.main`,
        bgcolor: alpha(theme.palette[color].main, 0.12),
      })}
    >
      {icon}
    </Box>
    <Typography variant="subtitle2">{title}</Typography>
  </Stack>
)

export const AssessmentTooltip = ({
  sources,
  children,
  description,
}: {
  sources: IpAssessment[]
  children: ReactElement
  description?: string
}) => {
  const { t } = useTranslation()
  return (
    <Tooltip
      describeChild
      title={[
        description,
        ...sources.map(
          (source) =>
            `${source.provider} · ${t('home.network.checkedAt', {
              time: new Date(source.checkedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}${[source.asn, source.organization, source.location].some(Boolean) ? `\n${[source.asn, source.organization, source.location].filter(Boolean).join(' · ')}` : ''}`,
        ),
      ]
        .filter(Boolean)
        .join('\n')}
      slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}
    >
      {children}
    </Tooltip>
  )
}

export const IpAssessmentPanel = () => {
  const { t } = useTranslation()
  const { data, error, isLoading } = useIpAssessment()
  const results = data ?? []
  const flags = FLAG_NAMES.flatMap((name) =>
    groupAssessmentValues(results, (result) => result.flags[name]).map(
      ({ value }) => value,
    ),
  )
  const flagged =
    flags.some((value) => value === true) ||
    results.some((result) =>
      Object.values(result.checks).some((value) => value === true),
    )
  const complete = flags.length > 0 && flags.every((value) => value !== null)
  const status = flagged ? 'flagged' : complete ? 'unflagged' : 'unknown'
  const scores = groupAssessmentValues(results, (result) => result.riskScore)
  const broadcasts = groupAssessmentValues(
    results,
    (result) => result.broadcast,
  )

  return (
    <Stack
      spacing={1.5}
      sx={{
        height: '100%',
        minWidth: 0,
        '& .MuiTypography-body2': { fontSize: 12 },
        '& .MuiTypography-caption': { fontSize: 11 },
        '& .MuiChip-root': {
          fontSize: 11,
          height: 20,
          '& .MuiChip-icon': { fontSize: 14 },
        },
      }}
    >
      <IpPanelTitle
        icon={<ShieldOutlined fontSize="small" />}
        color="success"
        title={t('home.network.purity')}
      />
      {isLoading && !data ? (
        <Stack spacing={1} aria-label={t('home.network.loading')}>
          <Skeleton height={56} width="75%" />
          <Skeleton height={30} />
          <Skeleton height={30} width="60%" />
        </Stack>
      ) : error || !data ? (
        <Alert severity="warning">{t('home.network.failed')}</Alert>
      ) : (
        <Stack spacing={1} sx={{ height: '100%' }}>
          {results.some((result) => result.fallback) && (
            <Alert severity="info" sx={{ py: 0 }}>
              {t('home.network.fallback')}
            </Alert>
          )}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              minHeight: 36,
              gap: 0.5,
            }}
          >
            {groupAssessmentValues(results, (result) =>
              result.networkType === 'unknown' ? null : result.networkType,
            ).map(({ value, sources }) => (
              <AssessmentTooltip key={value ?? 'unknown'} sources={sources}>
                <Chip
                  size="small"
                  color={getNetworkTypeColor(value ?? 'unknown')}
                  variant={value === 'residential' ? 'filled' : 'outlined'}
                  tabIndex={0}
                  label={t(`home.network.types.${value ?? 'unknown'}`)}
                />
              </AssessmentTooltip>
            ))}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {scores.map(({ value, sources }) => (
              <AssessmentTooltip key={value ?? 'unknown'} sources={sources}>
                <Chip
                  size="small"
                  tabIndex={0}
                  icon={
                    value === null && status === 'unflagged' ? (
                      <CheckCircleOutlineRounded />
                    ) : undefined
                  }
                  color={
                    value === null
                      ? flagged
                        ? 'warning'
                        : 'default'
                      : getIpRiskColor(value)
                  }
                  label={
                    value === null
                      ? t(`home.network.${status}`)
                      : `${t('home.network.score', { score: value })} · ${t(`home.network.riskLevels.${getIpRiskColor(value)}`)}`
                  }
                />
              </AssessmentTooltip>
            ))}
            {broadcasts
              .filter(({ value }) => value !== null)
              .map(({ value, sources }) => (
                <AssessmentTooltip key={String(value)} sources={sources}>
                  <Chip
                    size="small"
                    variant={value ? 'outlined' : 'filled'}
                    color={value ? 'warning' : 'success'}
                    tabIndex={0}
                    label={t(
                      value ? 'home.network.broadcast' : 'home.network.native',
                    )}
                  />
                </AssessmentTooltip>
              ))}
          </Box>
          {scores.map(({ value, sources }) => (
            <AssessmentTooltip
              key={value ?? 'unknown'}
              sources={sources}
              description={`${t('home.network.lowerBetter')}
${t('home.network.riskBands')}
${t('home.network.referenceOnly')}`}
            >
              <Box tabIndex={0} sx={{ cursor: 'help' }}>
                <Typography variant="body2" color="text.secondary">
                  {value === null
                    ? t('home.network.detection')
                    : t('home.network.riskScore', {
                        provider: sources
                          .map((source) => source.provider)
                          .join(' / '),
                      })}
                </Typography>
                {value !== null ? (
                  <>
                    <Typography
                      component="div"
                      sx={{
                        fontSize: 22,
                        color: `${getIpRiskColor(value)}.main`,
                        fontWeight: 700,
                        lineHeight: 1.3,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {value}
                      <Typography
                        component="span"
                        color="text.secondary"
                        sx={{ ml: 0.5, fontSize: 12 }}
                      >
                        / 100
                      </Typography>
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      color={
                        getIpRiskColor(value) === 'default'
                          ? 'primary'
                          : (getIpRiskColor(value) as
                              | 'success'
                              | 'warning'
                              | 'error')
                      }
                      value={value}
                      aria-label={t('home.network.riskScore', {
                        provider: sources
                          .map((source) => source.provider)
                          .join(' / '),
                      })}
                      sx={{ height: 4, borderRadius: 3, mt: 0.5 }}
                    />
                  </>
                ) : (
                  <Typography
                    sx={{ fontSize: 16, fontWeight: 650, my: 0.5 }}
                    color={
                      flagged
                        ? 'warning.main'
                        : complete
                          ? 'success.main'
                          : 'text.secondary'
                    }
                  >
                    {t(`home.network.${status}`)}
                  </Typography>
                )}
              </Box>
            </AssessmentTooltip>
          ))}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {FLAG_NAMES.flatMap((name) =>
              groupAssessmentValues(
                results,
                (result) => result.flags[name],
              ).map(({ value, sources }) => (
                <AssessmentTooltip key={`${name}-${value}`} sources={sources}>
                  <Chip
                    size="small"
                    variant="outlined"
                    tabIndex={0}
                    color={
                      value === true
                        ? 'warning'
                        : value === false
                          ? 'success'
                          : 'default'
                    }
                    label={`${t(`home.network.flags.${name}`)} · ${t(value === null ? 'home.network.unknown' : value ? 'home.network.yes' : 'home.network.no')}`}
                  />
                </AssessmentTooltip>
              )),
            )}
          </Box>
          <AssessmentTooltip
            sources={results}
            description={t('home.network.referenceOnly')}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              tabIndex={0}
              sx={{ mt: 'auto !important', pt: 1 }}
            >
              {[...new Set(results.map((result) => result.provider))].join(
                ' · ',
              )}
            </Typography>
          </AssessmentTooltip>
        </Stack>
      )}
    </Stack>
  )
}
