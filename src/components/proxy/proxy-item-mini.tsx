import { CheckCircleOutlineRounded } from '@mui/icons-material'
import {
  alpha,
  Box,
  ListItemButton,
  styled,
  Tooltip,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoading } from '@/components/base'
import { useProxyDelayState } from '@/hooks/use-proxy-delay-state'
import delayManager from '@/services/delay'
import speedManager, {
  loadSpeedTestConfig,
  saveSpeedTestConfig,
  SpeedUpdate,
} from '@/services/speed'

interface Props {
  group: IProxyGroupItem
  proxy: IProxyItem
  selected: boolean
  showType?: boolean
  onClick?: (name: string) => void
}

// 多列布局
export const ProxyItemMini = (props: Props) => {
  const { group, proxy, selected, showType = true, onClick } = props

  const { t } = useTranslation()

  // -1/<=0 为不显示，-2 为 loading
  const { delayState, delayValue, isPreset, timeout, onDelay } =
    useProxyDelayState(proxy, group.name)
  const [speedState, setSpeedState] = useReducer(
    (_: SpeedUpdate, next: SpeedUpdate) => next,
    {
      speed: -1,
      updatedAt: 0,
    },
  )

  useEffect(() => {
    if (isPreset) return
    speedManager.setListener(proxy.name, group.name, setSpeedState)
    return () => {
      speedManager.removeListener(proxy.name, group.name)
    }
  }, [isPreset, proxy.name, group.name])

  useEffect(() => {
    if (isPreset) return
    const cachedUpdate = speedManager.getSpeedUpdate(proxy.name, group.name)
    if (cachedUpdate) {
      setSpeedState(cachedUpdate)
    }
  }, [proxy.name, group.name, isPreset])

  const onSpeed = useLockFn(async () => {
    const config = await loadSpeedTestConfig()
    setSpeedState({ speed: -2, updatedAt: Date.now() })
    setSpeedState(
      await speedManager.checkSpeed(proxy.name, group.name, timeout, {
        config,
        onConfigChange: saveSpeedTestConfig,
      }),
    )
  })

  const speedValue = speedState.speed
  const delayTitle =
    delayState.error ||
    (delayValue === 0 || (delayValue >= timeout && delayValue <= 1e5)
      ? `Delay test timed out after ${timeout}ms`
      : delayValue > 1e5
        ? 'Delay test error'
        : '')
  const speedTitle = [
    speedState.error,
    typeof speedState.ttfb === 'number' ? `TTFB ${speedState.ttfb}ms` : '',
    speedState.earlyEof ? 'Early EOF' : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <ListItemButton
      dense
      selected={selected}
      onClick={() => onClick?.(proxy.name)}
      sx={[
        {
          height: 56,
          borderRadius: 1.5,
          pl: 1.5,
          pr: 1,
          containerType: 'inline-size',
          justifyContent: 'space-between',
          alignItems: 'center',
          '@container (min-width: 340px)': {
            '& .the-metrics': {
              flexDirection: 'row',
              flexWrap: 'nowrap',
              maxWidth: 'none',
            },
          },
        },
        ({ palette: { mode, primary } }) => {
          const bgcolor = mode === 'light' ? '#ffffff' : '#24252f'
          const showDelay = delayValue >= 0
          const selectColor = mode === 'light' ? primary.main : primary.light

          return {
            '&:hover .the-check': { display: !showDelay ? 'block' : 'none' },
            '&:hover .the-delay': { display: showDelay ? 'block' : 'none' },
            '&:hover .the-icon': { display: 'none' },
            '& .the-pin, & .the-unpin': {
              position: 'absolute',
              fontSize: '12px',
              top: '-5px',
              right: '-5px',
            },
            '& .the-unpin': { filter: 'grayscale(1)' },
            '&.Mui-selected': {
              width: `calc(100% + 3px)`,
              marginLeft: `-3px`,
              borderLeft: `3px solid ${selectColor}`,
              bgcolor:
                mode === 'light'
                  ? alpha(primary.main, 0.15)
                  : alpha(primary.main, 0.35),
            },
            backgroundColor: bgcolor,
          }
        },
      ]}
    >
      <Box
        title={`${proxy.name}\n${proxy.now ?? ''}`}
        sx={{ overflow: 'hidden', flex: '1 1 auto', minWidth: 0, pr: 1 }}
      >
        <Typography
          variant="body2"
          component="div"
          color="text.primary"
          sx={{
            display: 'block',
            textOverflow: 'ellipsis',
            wordBreak: 'break-all',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {proxy.name}
        </Typography>

        {showType && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'nowrap',
              flex: 'none',
              marginTop: '4px',
            }}
          >
            {proxy.now && (
              <Typography
                variant="body2"
                component="div"
                color="text.secondary"
                sx={{
                  display: 'block',
                  textOverflow: 'ellipsis',
                  wordBreak: 'break-all',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  marginRight: '8px',
                }}
              >
                {proxy.now}
              </Typography>
            )}
            {!!proxy.provider && (
              <TypeBox color="text.secondary" component="span">
                {proxy.provider}
              </TypeBox>
            )}
            <TypeBox color="text.secondary" component="span">
              {proxy.type}
            </TypeBox>
            {proxy.udp && (
              <TypeBox color="text.secondary" component="span">
                UDP
              </TypeBox>
            )}
            {proxy.xudp && (
              <TypeBox color="text.secondary" component="span">
                XUDP
              </TypeBox>
            )}
            {proxy.tfo && (
              <TypeBox color="text.secondary" component="span">
                TFO
              </TypeBox>
            )}
            {proxy.mptcp && (
              <TypeBox color="text.secondary" component="span">
                MPTCP
              </TypeBox>
            )}
            {proxy.smux && (
              <TypeBox color="text.secondary" component="span">
                SMUX
              </TypeBox>
            )}
          </Box>
        )}
      </Box>
      <Box
        className="the-metrics"
        sx={{
          ml: 1,
          minWidth: 64,
          maxWidth: '48%',
          flexShrink: 0,
          color: 'primary.main',
          display: isPreset ? 'none' : 'flex',
          flexDirection: 'column',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: '2px 6px',
        }}
      >
        {(delayValue === -2 || speedValue === -2) && (
          <Widget>
            <BaseLoading />
          </Widget>
        )}
        {!proxy.provider && delayValue !== -2 && speedValue !== -2 && (
          // provider 的节点不支持检测
          <Widget
            className="the-check"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDelay()
            }}
            sx={({ palette }) => ({
              display: 'none', // hover 时显示
              ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
            })}
          >
            Check
          </Widget>
        )}

        {delayValue >= 0 && speedValue !== -2 && (
          // 显示延迟
          <Widget
            className="the-delay"
            title={delayTitle || undefined}
            onClick={(e) => {
              if (proxy.provider) return
              e.preventDefault()
              e.stopPropagation()
              onDelay()
            }}
            sx={({ palette }) => ({
              color: delayManager.formatDelayColor(delayValue, timeout),
              ...(!proxy.provider
                ? { ':hover': { bgcolor: alpha(palette.primary.main, 0.15) } }
                : {}),
            })}
          >
            {delayManager.formatDelay(delayValue, timeout)}
          </Widget>
        )}
        {speedValue > 0 && speedValue !== -2 && (
          <Tooltip title={speedTitle} arrow disableHoverListener={!speedTitle}>
            <Widget
              className="the-delay"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSpeed()
              }}
              sx={({ palette }) => ({
                color: speedManager.formatSpeedColor(
                  speedValue,
                  speedState.earlyEof,
                ),
                ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
              })}
            >
              {speedManager.formatSpeed(speedValue)}
            </Widget>
          </Tooltip>
        )}
        {speedValue === -3 && (
          <Tooltip title={speedTitle || 'Error'} arrow>
            <Widget
              className="the-delay"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSpeed()
              }}
              sx={({ palette }) => ({
                color: 'error.main',
                ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
              })}
            >
              Error
            </Widget>
          </Tooltip>
        )}
        {proxy.type !== 'Direct' &&
          delayValue !== -2 &&
          speedValue !== -2 &&
          delayValue < 0 &&
          selected && (
            // 展示已选择的 icon
            <CheckCircleOutlineRounded
              className="the-icon"
              sx={{ fontSize: 16, mr: 0.5, display: 'block' }}
            />
          )}
      </Box>
      {group.fixed && group.fixed === proxy.name && (
        // 展示 fixed 状态
        <span
          className={proxy.name === group.now ? 'the-pin' : 'the-unpin'}
          title={
            group.type === 'URLTest'
              ? t('proxies.page.labels.delayCheckReset')
              : ''
          }
        >
          📌
        </span>
      )}
    </ListItemButton>
  )
}

const Widget = styled(Box)(({ theme: { typography } }) => ({
  padding: '1px 2px',
  fontSize: 13,
  fontFamily: typography.fontFamily,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.3,
  maxWidth: '100%',
  minHeight: 18,
  overflow: 'hidden',
  textAlign: 'right',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  borderRadius: '4px',
}))

const TypeBox = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'component',
})<{ component?: React.ElementType }>(({ theme: { typography } }) => ({
  display: 'inline-block',
  border: '1px solid #ccc',
  borderColor: 'text.secondary',
  color: 'text.secondary',
  borderRadius: 4,
  fontSize: 10,
  fontFamily: typography.fontFamily,
  marginRight: '4px',
  marginTop: 'auto',
  padding: '0 4px',
  lineHeight: 1.5,
}))
