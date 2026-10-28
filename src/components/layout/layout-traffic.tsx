import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  ErrorOutlineRounded,
  MemoryRounded,
} from '@mui/icons-material'
import type { BoxProps, SvgIconProps, TypographyProps } from '@mui/material'
import { Box, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { useMemoryData } from '@/hooks/use-memory-data'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import parseTraffic from '@/utils/parse-traffic'

import { TrafficGraph, type TrafficRef } from './traffic-graph'

const unavailableSx = {
  p: 1,
  minHeight: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  bgcolor: 'error.light',
  borderRadius: 1,
  color: 'error.contrastText',
}

const TrafficUnavailableFallback = () => {
  const { t } = useTranslation()

  return (
    <Box sx={unavailableSx}>
      <ErrorOutlineRounded sx={{ mr: 1, fontSize: 20 }} />
      <Typography variant="caption">
        {t('shared.feedback.errors.trafficUnavailable')}
      </Typography>
    </Box>
  )
}

export const LayoutTraffic = () => {
  const { t } = useTranslation()
  const { verge } = useVerge()

  const trafficGraph = verge?.traffic_graph ?? true
  const displayMemory = verge?.enable_memory_usage ?? true

  const trafficRef = useRef<TrafficRef>(null)
  const pageVisible = useVisibility()

  const {
    response: { data: traffic },
  } = useTrafficData({ enabled: pageVisible })
  const {
    response: { data: memory },
  } = useMemoryData({ enabled: displayMemory && pageVisible })

  useEffect(() => {
    if (trafficRef.current) {
      trafficRef.current.appendData({
        up: traffic?.up || 0,
        down: traffic?.down || 0,
        upTotal: traffic?.upTotal || 0,
        downTotal: traffic?.downTotal || 0,
      })
    }
  }, [traffic])

  const [up, upUnit] = parseTraffic(traffic?.up || 0)
  const [down, downUnit] = parseTraffic(traffic?.down || 0)
  const [inuse, inuseUnit] = parseTraffic(memory?.inuse || 0)

  const boxStyle: Pick<BoxProps, 'sx'> = {
    sx: {
      display: 'flex',
      alignItems: 'center',
      whiteSpace: 'nowrap',
    },
  }
  const iconStyle: Pick<SvgIconProps, 'sx'> = {
    sx: { mr: '8px', fontSize: 16 },
  }
  const valStyle: Pick<TypographyProps, 'component' | 'sx'> = {
    component: 'span',
    sx: { flex: '1 1 56px', userSelect: 'none', textAlign: 'center' },
  }
  const unitStyle: Pick<TypographyProps, 'component' | 'color' | 'sx'> = {
    component: 'span',
    color: 'grey.500',
    sx: {
      flex: '0 1 27px',
      userSelect: 'none',
      fontSize: '12px',
      textAlign: 'right',
    },
  }

  return (
    <ErrorBoundary
      FallbackComponent={TrafficUnavailableFallback}
      onError={(error, errorInfo) =>
        console.error('[LayoutTraffic]', error, errorInfo)
      }
    >
      <Box sx={{ position: 'relative' }}>
        {trafficGraph && pageVisible && (
          <div
            style={{ width: '100%', height: 60, marginBottom: 6 }}
            onClick={trafficRef.current?.toggleStyle}
          >
            <TrafficGraph ref={trafficRef} />
          </div>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box
            title={`${t('home.components.traffic.metrics.uploadSpeed')}`}
            {...boxStyle}
            sx={{
              ...boxStyle.sx,
            }}
          >
            <ArrowUpwardRounded
              {...iconStyle}
              color={(traffic?.up || 0) > 0 ? 'secondary' : 'disabled'}
            />
            <Typography {...valStyle} color="secondary">
              {up}
            </Typography>
            <Typography {...unitStyle}>{upUnit}/s</Typography>
          </Box>

          <Box
            title={`${t('home.components.traffic.metrics.downloadSpeed')}`}
            {...boxStyle}
            sx={{
              ...boxStyle.sx,
            }}
          >
            <ArrowDownwardRounded
              {...iconStyle}
              color={(traffic?.down || 0) > 0 ? 'primary' : 'disabled'}
            />
            <Typography {...valStyle} color="primary">
              {down}
            </Typography>
            <Typography {...unitStyle}>{downUnit}/s</Typography>
          </Box>

          {displayMemory && (
            <Box
              title={`${t('home.components.traffic.metrics.memoryUsage')} `}
              {...boxStyle}
              sx={{
                ...boxStyle.sx,
                cursor: 'auto',
              }}
              color={'disabled'}
            >
              <MemoryRounded {...iconStyle} />
              <Typography {...valStyle}>{inuse}</Typography>
              <Typography {...unitStyle}>{inuseUnit}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </ErrorBoundary>
  )
}
