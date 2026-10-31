import { CheckCircleOutlineRounded } from '@mui/icons-material'
import {
  alpha,
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  styled,
  type SxProps,
  type Theme,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

import { BaseLoading } from '@/components/base'
import { useProxyDelayState } from '@/hooks/use-proxy-delay-state'
import delayManager from '@/services/delay'
import { formatSpeed } from '@/services/speed'
import {
  memberDetails,
  type ProxyGroupView,
  type ResolvedProxyMember,
} from '@/types/proxy-view'

interface Props {
  group: ProxyGroupView
  member: ResolvedProxyMember
  selected: boolean
  showType?: boolean
  sx?: SxProps<Theme>
  onClick?: (member: ResolvedProxyMember) => void
}

const Widget = styled(Box)(() => ({
  padding: '3px 6px',
  fontSize: 14,
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
  const { t } = useTranslation()
  const { group, member, selected, showType = true, sx, onClick } = props
  const details = memberDetails(member)
  const unresolved = member.kind === 'unresolved'
  const name = member.ref.name
  const type = unresolved ? member.ref.reason : (details?.type ?? '')
  const now = member.kind === 'group' ? member.group.now : undefined

  // -1/<=0 为不显示，-2 为 loading
  const {
    delayValue,
    speedValue,
    peakValue,
    speedError,
    isPreset,
    timeout,
    onDelay,
  } = useProxyDelayState(member, group.name)

  return (
    <ListItem sx={sx}>
      <ListItemButton
        dense
        disabled={unresolved}
        selected={!unresolved && selected}
        onClick={unresolved ? undefined : () => onClick?.(member)}
        sx={[
          { borderRadius: 1 },
          ({ palette: { mode, primary } }) => {
            const bgcolor = mode === 'light' ? '#ffffff' : '#24252f'
            const selectColor = mode === 'light' ? primary.main : primary.light
            const showDelay = delayValue > 0

            return {
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
              minHeight: '48px',
              py: '4px',
            }
          },
        ]}
      >
        <ListItemText
          title={name}
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
                {name}
                {showType && now && ` - ${now}`}
              </Box>
              {showType && <TypeBox>{type}</TypeBox>}
              {!unresolved && showType && details?.udp && (
                <TypeBox>UDP</TypeBox>
              )}
              {!unresolved && showType && details?.xudp && (
                <TypeBox>XUDP</TypeBox>
              )}
              {!unresolved && showType && details?.tfo && (
                <TypeBox>TFO</TypeBox>
              )}
              {!unresolved && showType && details?.mptcp && (
                <TypeBox>MPTCP</TypeBox>
              )}
              {!unresolved && showType && details?.smux && (
                <TypeBox>SMUX</TypeBox>
              )}
            </>
          }
        />

        <ListItemIcon
          sx={{
            justifyContent: 'flex-end',
            color: 'primary.main',
            display: isPreset ? 'none' : '',
            minWidth: 76,
            flexShrink: 0,
            alignSelf: 'stretch',
          }}
        >
          {!unresolved && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: '2px',
              }}
            >
              {delayValue === -2 ? (
                <Widget>
                  <BaseLoading />
                </Widget>
              ) : delayValue > 0 ? (
                // 显示延迟
                <Widget
                  className="the-delay"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void onDelay()
                  }}
                  sx={({ palette }) => ({
                    color: delayManager.formatDelayColor(delayValue, timeout),
                    ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
                  })}
                >
                  {delayManager.formatDelay(delayValue, timeout)}
                </Widget>
              ) : (
                <Widget
                  className="the-check"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void onDelay()
                  }}
                  sx={({ palette }) => ({
                    display: 'none', // hover 时显示
                    ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
                  })}
                >
                  {t('shared.actions.check')}
                </Widget>
              )}

              {speedValue === -2 ? (
                <Box
                  component="span"
                  title={t('shared.speed')}
                  sx={{
                    fontSize: 11,
                    color: 'text.secondary',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ↓ …
                </Box>
              ) : speedValue > 0 ? (
                <Box
                  component="span"
                  title={`${t('shared.speed')} · ${t('shared.speedPeak')} ${formatSpeed(peakValue)} · ${t('shared.speedAvg')} ${formatSpeed(speedValue)}`}
                  sx={{
                    fontSize: 11,
                    color: 'text.secondary',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ↓ {formatSpeed(peakValue > 0 ? peakValue : speedValue)}
                </Box>
              ) : speedError ? (
                <Box
                  component="span"
                  title={speedError}
                  sx={{
                    fontSize: 11,
                    color: 'error.main',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('shared.speedFail')}
                </Box>
              ) : null}
            </Box>
          )}

          {!unresolved && delayValue !== -2 && delayValue <= 0 && selected && (
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
