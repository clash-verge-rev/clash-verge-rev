import { CheckCircleOutlineRounded } from '@mui/icons-material'
import {
  alpha,
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  styled,
  SxProps,
  Theme,
  Tooltip,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useReducer } from 'react'

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
  sx?: SxProps<Theme>
  onClick?: (name: string) => void
}

const Widget = styled(Box)(() => ({
  padding: '1px 2px',
  fontSize: 13,
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

const TypeBox = styled('span')(({ theme }) => ({
  display: 'inline-block',
  border: '1px solid #ccc',
  borderColor: alpha(theme.palette.text.secondary, 0.36),
  color: alpha(theme.palette.text.secondary, 0.42),
  borderRadius: 4,
  fontSize: 10,
  marginRight: '4px',
  padding: '0 2px',
  lineHeight: 1.25,
}))

export const ProxyItem = (props: Props) => {
  const { group, proxy, selected, showType = true, sx, onClick } = props

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
  }, [proxy.name, group.name, isPreset])

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
    <ListItem sx={sx}>
      <ListItemButton
        dense
        selected={selected}
        onClick={() => onClick?.(proxy.name)}
        sx={[
          { borderRadius: 1 },
          ({ palette: { mode, primary } }) => {
            const bgcolor = mode === 'light' ? '#ffffff' : '#24252f'
            const selectColor = mode === 'light' ? primary.main : primary.light
            const showDelay = delayValue >= 0

            return {
              containerType: 'inline-size',
              '@container (min-width: 340px)': {
                '& .the-metrics': {
                  flexDirection: 'row',
                  flexWrap: 'nowrap',
                  maxWidth: 'none',
                },
              },
              '&:hover .the-check': { display: !showDelay ? 'block' : 'none' },
              '&:hover .the-delay': { display: showDelay ? 'block' : 'none' },
              '&:hover .the-icon': { display: 'none' },
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
              marginBottom: '8px',
              height: '40px',
            }
          },
        ]}
      >
        <ListItemText
          title={proxy.name}
          sx={{ minWidth: 0, pr: 1 }}
          secondary={
            <>
              <Box
                sx={{
                  display: 'inline-block',
                  marginRight: '8px',
                  fontSize: '14px',
                  color: 'text.primary',
                }}
              >
                {proxy.name}
                {showType && proxy.now && ` - ${proxy.now}`}
              </Box>
              {showType && !!proxy.provider && (
                <TypeBox>{proxy.provider}</TypeBox>
              )}
              {showType && <TypeBox>{proxy.type}</TypeBox>}
              {showType && proxy.udp && <TypeBox>UDP</TypeBox>}
              {showType && proxy.xudp && <TypeBox>XUDP</TypeBox>}
              {showType && proxy.tfo && <TypeBox>TFO</TypeBox>}
              {showType && proxy.mptcp && <TypeBox>MPTCP</TypeBox>}
              {showType && proxy.smux && <TypeBox>SMUX</TypeBox>}
            </>
          }
        />

        <ListItemIcon
          className="the-metrics"
          sx={{
            minWidth: 64,
            maxWidth: '48%',
            flexShrink: 0,
            flexDirection: 'column',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            color: 'primary.main',
            display: isPreset ? 'none' : '',
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

          {speedValue !== -2 && speedValue > 0 && (
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

          {delayValue !== -2 && speedValue !== -2 && delayValue <= 0 && selected && (
            // 展示已选择的 icon
            <CheckCircleOutlineRounded
              className="the-icon"
              sx={{ fontSize: 16 }}
            />
          )}
        </ListItemIcon>
      </ListItemButton>
    </ListItem>
  )
}
