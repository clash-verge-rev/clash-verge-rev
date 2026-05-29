import { CheckCircleOutlineRounded, EditRounded } from '@mui/icons-material'
import {
  alpha,
  Box,
  IconButton,
  ListItemButton,
  styled,
  Typography,
} from '@mui/material'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoading } from '@/components/base'
import { useProxyDelayState } from '@/hooks/use-proxy-delay-state'
import delayManager from '@/services/delay'

interface Props {
  group: IProxyGroupItem
  proxy: IProxyItem
  selected: boolean
  showType?: boolean
  onClick?: (name: string) => void
  onEdit?: (name: string) => void
  onContextMenu?: (event: MouseEvent<HTMLElement>, name: string) => void
  large?: boolean
}

// 多列布局
export const ProxyItemMini = (props: Props) => {
  const {
    group,
    proxy,
    selected,
    showType = true,
    onClick,
    onEdit,
    onContextMenu,
    large = false,
  } = props

  const { t } = useTranslation()

  // -1/<=0 为不显示，-2 为 loading
  const { delayValue, isPreset, timeout, onDelay } = useProxyDelayState(
    proxy,
    group.name,
  )

  return (
    <ListItemButton
      dense
      selected={selected}
      onClick={() => onClick?.(proxy.name)}
      onContextMenu={(event) => {
        if (!onContextMenu) return
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event, proxy.name)
      }}
      onDoubleClick={(event) => {
        if (!onEdit) return
        event.preventDefault()
        event.stopPropagation()
        onEdit(proxy.name)
      }}
      sx={[
        {
          height: large ? 96 : 56,
          borderRadius: 1.5,
          p: large ? 1.5 : undefined,
          pl: large ? 1.5 : 1.5,
          pr: large ? 1.5 : 1,
          justifyContent: 'space-between',
          alignItems: large ? 'stretch' : 'center',
        },
        ({ palette: { mode, primary } }) => {
          const bgcolor = mode === 'light' ? '#ffffff' : '#24252f'
          const showDelay = delayValue > 0
          const selectColor = mode === 'light' ? primary.main : primary.light

          return {
            '&:hover .the-check': { display: !showDelay ? 'block' : 'none' },
            '&:hover .the-delay': { display: showDelay ? 'block' : 'none' },
            '&:hover .the-edit': { opacity: 1 },
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
        sx={{
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: large ? 'space-between' : 'center',
        }}
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
              overflow: 'hidden',
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
        sx={{
          ml: 0.5,
          color: 'primary.main',
          display: 'inline-flex',
          alignItems: 'center',
          alignSelf: 'center',
          gap: 0.25,
          visibility: isPreset && !onEdit ? 'hidden' : 'visible',
        }}
      >
        {onEdit && (
          <IconButton
            className="the-edit"
            size="small"
            title={t('shared.actions.edit')}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onEdit(proxy.name)
            }}
            sx={{
              width: 22,
              height: 22,
              opacity: selected ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          >
            <EditRounded sx={{ fontSize: 15 }} />
          </IconButton>
        )}
        {delayValue === -2 && (
          <Widget>
            <BaseLoading />
          </Widget>
        )}
        {!proxy.provider && delayValue !== -2 && (
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

        {delayValue >= 0 && (
          // 显示延迟
          <Widget
            className="the-delay"
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
        {proxy.type !== 'Direct' &&
          delayValue !== -2 &&
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
  padding: '2px 4px',
  fontSize: 14,
  fontFamily: typography.fontFamily,
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
