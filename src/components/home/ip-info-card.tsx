import {
  LocationOnOutlined,
  RefreshOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from '@mui/icons-material'
import { Box, Button, IconButton, Skeleton, Typography } from '@mui/material'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useEffect } from 'foxact/use-abortable-effect'
import { useIntersection } from 'foxact/use-intersection'
import type { XOR } from 'foxts/ts-xor'
import {
  forwardRef,
  memo,
  useCallback,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { getIpInfo } from '@/services/api'
import { useQuery } from '@/services/query-client'
import getSystem from '@/utils/get-system'

import { EnhancedCard } from './enhanced-card'

const IP_REFRESH_SECONDS = 300
const COUNTDOWN_TICK_INTERVAL = 5_000
const IP_INFO_CACHE_KEY = 'cv_ip_info_cache'

const InfoItem = memo(({ label, value }: { label: string; value?: string }) => (
  <Box sx={{ mb: 0.7, display: 'flex', alignItems: 'flex-start' }}>
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ minwidth: 60, mr: 0.5, flexShrink: 0, textAlign: 'right' }}
    >
      {label}:
    </Typography>
    <Typography
      variant="body2"
      sx={{
        ml: 0.5,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        wordBreak: 'break-word',
        whiteSpace: 'normal',
        flexGrow: 1,
      }}
    >
      {value || 'Unknown'}
    </Typography>
  </Box>
))

const getCountryFlag = (countryCode: string | undefined) => {
  if (!countryCode) return ''
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}

type CountDownState = XOR<
  {
    type: 'countdown'
    remainingSeconds: number
  },
  {
    type: 'revalidating'
  }
>

const IPInfoCardContainer = forwardRef<HTMLElement, React.PropsWithChildren>(
  ({ children }, ref) => {
    const { t } = useTranslation()
    const { refetch: mutate } = useIPInfo()

    return (
      <EnhancedCard
        title={t('home.components.ipInfo.title')}
        icon={<LocationOnOutlined />}
        iconColor="info"
        ref={ref}
        action={
          <IconButton size="small" onClick={() => mutate()}>
            <RefreshOutlined />
          </IconButton>
        }
      >
        {children}
      </EnhancedCard>
    )
  },
)

export const IpInfoCard = () => {
  const { t } = useTranslation()
  const [showIp, setShowIp] = useState(false)
  const appWindow = useMemo(() => getCurrentWebviewWindow(), [])

  // Once intersected, refreshes stay enabled until unmount.
  const [containerRef, hasIntersected, _resetIntersected] = useIntersection({
    rootMargin: '0px',
  })

  const [countdown, setCountdown] = useState<CountDownState>({
    type: 'countdown',
    remainingSeconds: IP_REFRESH_SECONDS,
  })

  const { data: ipInfo, error, isLoading, refetch: mutate } = useIPInfo()

  const onCountdownTick = useEffectEvent(async () => {
    const now = Date.now()
    const ts = ipInfo?.lastFetchTs
    if (!ts) {
      return
    }

    const elapsed = Math.floor((now - ts) / 1000)
    const remaining = IP_REFRESH_SECONDS - elapsed

    if (remaining <= 0) {
      if (
        hasIntersected &&
        navigator.onLine &&
        countdown.type !== 'revalidating' &&
        (await appWindow.isVisible())
      ) {
        setCountdown({ type: 'revalidating' })
        try {
          await mutate()
        } finally {
          setCountdown({
            type: 'countdown',
            remainingSeconds: IP_REFRESH_SECONDS,
          })
        }
      } else {
        // Keep the expired state so the next eligible tick refreshes immediately.
      }
    } else {
      setCountdown({
        type: 'countdown',
        remainingSeconds: remaining,
      })
    }
  })

  useEffect(() => {
    let timer: number | null = null

    // Prefer DOM intersection state; Tauri visibility is unreliable on some platforms.
    if (hasIntersected) {
      console.debug(
        'IP info card has entered the viewport, starting the countdown interval.',
      )
      timer = window.setInterval(onCountdownTick, COUNTDOWN_TICK_INTERVAL)
    } else {
      console.debug(
        'IP info card has not yet entered the viewport, no counting down.',
      )
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    // Best-effort power saving; see https://github.com/tauri-apps/tauri/issues/10592.
    function onVisibilityChange() {
      if (document.hidden) {
        console.debug('Document hidden, pause the interval')
        if (timer != null) {
          clearInterval(timer)
          timer = null
        }
      } else if (hasIntersected) {
        console.debug('Document visible, resume the interval')
        if (timer == null) {
          timer = window.setInterval(onCountdownTick, COUNTDOWN_TICK_INTERVAL)
        }
      } else {
        console.debug(
          'Document visible, but IP info card has never entered the viewport, not even once, not starting the interval.',
        )
      }
    }

    return () => {
      if (timer != null) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [hasIntersected])

  const toggleShowIp = useCallback(() => {
    setShowIp((prev) => !prev)
  }, [])

  let mainElement: React.ReactElement

  switch (true) {
    case isLoading:
      mainElement = (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Skeleton variant="text" width="60%" height={30} />
          <Skeleton variant="text" width="80%" height={24} />
          <Skeleton variant="text" width="70%" height={24} />
          <Skeleton variant="text" width="50%" height={24} />
        </Box>
      )
      break
    case !!error:
      mainElement = (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'error.main',
          }}
        >
          <Typography variant="body1" color="error">
            {error instanceof Error
              ? error.message
              : t('home.components.ipInfo.errors.load')}
          </Typography>
          <Button onClick={() => mutate()} sx={{ mt: 2 }}>
            {t('shared.actions.retry')}
          </Button>
        </Box>
      )
      break
    default: // Normal render
      mainElement = (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              flex: 1,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ width: '40%', overflow: 'hidden' }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  mb: 1,
                  overflow: 'hidden',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    fontSize: '1.5rem',
                    mr: 1,
                    display: 'inline-block',
                    width: 28,
                    textAlign: 'center',
                    flexShrink: 0,
                    fontFamily:
                      getSystem() === 'windows'
                        ? '"twemoji mozilla", sans-serif'
                        : 'sans-serif',
                  }}
                >
                  {getCountryFlag(ipInfo?.country_code)}
                </Box>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 'medium',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                >
                  {ipInfo?.country ||
                    t('home.components.ipInfo.labels.unknown')}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ flexShrink: 0 }}
                >
                  {t('home.components.ipInfo.labels.ip')}:
                </Typography>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    ml: 1,
                    overflow: 'hidden',
                    maxWidth: 'calc(100% - 30px)',
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      wordBreak: 'break-all',
                    }}
                  >
                    {showIp ? ipInfo?.ip : '••••••••••'}
                  </Typography>
                  <IconButton size="small" onClick={toggleShowIp}>
                    {showIp ? (
                      <VisibilityOffOutlined fontSize="small" />
                    ) : (
                      <VisibilityOutlined fontSize="small" />
                    )}
                  </IconButton>
                </Box>
              </Box>

              <InfoItem
                label={t('home.components.ipInfo.labels.asn')}
                value={ipInfo?.asn ? `AS${ipInfo.asn}` : 'N/A'}
              />
            </Box>

            <Box sx={{ width: '60%', overflow: 'auto' }}>
              <InfoItem
                label={t('home.components.ipInfo.labels.isp')}
                value={ipInfo?.organization}
              />
              <InfoItem
                label={t('home.components.ipInfo.labels.org')}
                value={ipInfo?.asn_organization}
              />
              <InfoItem
                label={t('home.components.ipInfo.labels.location')}
                value={[ipInfo?.city, ipInfo?.region]
                  .filter(Boolean)
                  .join(', ')}
              />
              <InfoItem
                label={t('home.components.ipInfo.labels.timezone')}
                value={ipInfo?.timezone}
              />
            </Box>
          </Box>

          <Box
            sx={{
              mt: 'auto',
              pt: 0.5,
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              opacity: 0.7,
              fontSize: '0.7rem',
            }}
          >
            <Typography variant="caption">
              {t('home.components.ipInfo.labels.autoRefresh')}
              {countdown.type === 'countdown'
                ? `: ${countdown.remainingSeconds}s`
                : '...'}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {`${ipInfo?.country_code ?? 'N/A'}, ${ipInfo?.longitude?.toFixed(2) ?? 'N/A'}, ${ipInfo?.latitude?.toFixed(2) ?? 'N/A'}`}
            </Typography>
          </Box>
        </Box>
      )
  }

  return (
    <IPInfoCardContainer ref={containerRef}>{mainElement}</IPInfoCardContainer>
  )
}

function useIPInfo() {
  return useQuery({
    queryKey: [IP_INFO_CACHE_KEY],
    queryFn: getIpInfo,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 30_000,
  })
}
