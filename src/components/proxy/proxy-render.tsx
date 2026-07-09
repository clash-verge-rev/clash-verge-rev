import {
  ExpandLessRounded,
  ExpandMoreRounded,
  InboxRounded,
} from '@mui/icons-material'
import {
  alpha,
  Box,
  ListItemText,
  ListItemButton,
  Typography,
  styled,
  Chip,
  Tooltip,
} from '@mui/material'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useIconCache } from '@/hooks/use-icon-cache'
import { useVerge } from '@/hooks/use-verge'
import { useThemeMode } from '@/services/states'

import { ProxyGroupTools } from './proxy-group-tools'
import { ProxyHead } from './proxy-head'
import { ProxyItem } from './proxy-item'
import { ProxyItemMini } from './proxy-item-mini'
import type { HeadState } from './use-head-state'
import type { IRenderItem } from './use-render-list'

interface RenderProps {
  item: IRenderItem
  stickyed?: boolean
  isChainMode?: boolean
  onLocation: (group: IRenderItem['group']) => void
  onCheckAll: (groupName: string) => void
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
  onChangeProxy: (
    group: IRenderItem['group'],
    proxy: IRenderItem['proxy'] & { name: string },
  ) => void
  onGroupToggle?: (group: IRenderItem['group']) => void
}

export const ProxyRender = memo(function ProxyRender(props: RenderProps) {
  const { t } = useTranslation()
  const {
    item,
    stickyed = false,
    onLocation,
    onCheckAll,
    onHeadState,
    onChangeProxy,
    onGroupToggle,
    isChainMode: _ = false,
  } = props
  const { type, group, headState, proxy, proxyCol } = item
  const { verge } = useVerge()
  const enable_group_icon = verge?.enable_group_icon ?? true
  const mode = useThemeMode()
  const isDark = mode === 'dark'
  const itembackgroundcolor = isDark ? '#282A36' : '#ffffff'
  const iconCachePath = useIconCache({
    icon: group.icon,
    cacheKey: group.name.replaceAll(' ', ''),
    enabled: enable_group_icon,
  })

  const showType = headState?.showType
  const proxyColItemsMemo = useMemo(() => {
    if (type !== 4 || !proxyCol) {
      return null
    }

    return proxyCol.map((proxyItem) => (
      <ProxyItemMini
        key={`${item.key}-${proxyItem?.name ?? 'unknown'}`}
        group={group}
        proxy={proxyItem}
        selected={group.now === proxyItem?.name}
        showType={showType}
        onClick={() => onChangeProxy(group, proxyItem)}
      />
    ))
  }, [type, proxyCol, item.key, group, showType, onChangeProxy])

  if (type === 0) {
    return (
      <div style={{ padding: '4px 8px' }}>
        <ListItemButton
          dense
          sx={{
            boxShadow:
              stickyed && headState?.open
                ? '0 4px 8px rgba(0, 0, 0, 0.2) !important'
                : undefined,
          }}
          style={{
            background: itembackgroundcolor,
            height: '100%',
            borderRadius: '8px',
          }}
          onClick={() => {
            if (headState?.open) {
              onGroupToggle?.(group)
            }
            onHeadState?.(group.name, { open: !headState?.open })
          }}
        >
          {enable_group_icon && group.icon?.trim().startsWith('http') && (
            <img
              src={iconCachePath === '' ? group.icon : iconCachePath}
              alt="group icon"
              width="32px"
              style={{ marginRight: '12px', borderRadius: '6px' }}
            />
          )}
          {enable_group_icon && group.icon?.trim().startsWith('data') && (
            <img
              src={group.icon}
              alt="group icon"
              width="32px"
              style={{ marginRight: '12px', borderRadius: '6px' }}
            />
          )}
          {enable_group_icon && group.icon?.trim().startsWith('<svg') && (
            <img
              src={`data:image/svg+xml;base64,${btoa(group.icon)}`}
              alt="group icon"
              width="32px"
            />
          )}
          <ListItemText
            primary={<StyledPrimary>{group.name}</StyledPrimary>}
            secondary={
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  pt: '2px',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <StyledTypeBox>{group.type}</StyledTypeBox>
                  <StyledSubtitle sx={{ color: 'text.secondary' }}>
                    {group.now}
                  </StyledSubtitle>
                </Box>
              </Box>
            }
            slotProps={{
              secondary: {
                component: 'div',
                sx: { display: 'flex', alignItems: 'center', color: '#ccc' },
              },
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <ProxyGroupTools
              url={group.testUrl}
              groupName={group.name}
              headState={headState!}
              onLocation={() => onLocation(group)}
              onCheckDelay={() => onCheckAll(group.name)}
              onHeadState={(p) => onHeadState(group.name, p)}
            />
            <Tooltip title={t('proxies.page.labels.proxyCount')} arrow>
              <div
                style={{
                  minWidth: '50px',
                  display: 'flex',
                  justifyContent: 'end',
                  alignItems: 'center',
                }}
              >
                <Chip
                  size="small"
                  label={`${group.all.length}`}
                  sx={{
                    mr: 1,
                    backgroundColor: (theme) =>
                      alpha(theme.palette.primary.main, 0.1),
                    color: (theme) => theme.palette.primary.main,
                  }}
                />
              </div>
            </Tooltip>
            {headState?.open ? <ExpandLessRounded /> : <ExpandMoreRounded />}
          </Box>
        </ListItemButton>
      </div>
    )
  }

  if (type === 1) {
    return (
      <ProxyHead
        sx={{ pl: 2, pr: 3, mt: 0.5, mb: 1 }}
        url={group.testUrl}
        groupName={group.name}
        headState={headState!}
        onLocation={() => onLocation(group)}
        onCheckDelay={() => onCheckAll(group.name)}
        onHeadState={(p) => onHeadState(group.name, p)}
      />
    )
  }

  if (type === 2) {
    return (
      <ProxyItem
        group={group}
        proxy={proxy!}
        selected={group.now === proxy?.name}
        showType={headState?.showType}
        sx={{ py: 0, pl: 2 }}
        onClick={() => onChangeProxy(group, proxy!)}
      />
    )
  }

  if (type === 3) {
    return (
      <Box
        sx={{
          py: 2,
          pl: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <InboxRounded sx={{ fontSize: '2.5em', color: 'inherit' }} />
        <Typography sx={{ color: 'inherit' }}>No Proxies</Typography>
      </Box>
    )
  }

  if (type === 4) {
    return (
      <Box
        sx={{
          height: 56,
          display: 'grid',
          my: 0.5,
          gap: 1,
          px: 2,
          gridTemplateColumns: `repeat(${item.col! || 2}, 1fr)`,
        }}
      >
        {proxyColItemsMemo}
      </Box>
    )
  }

  return null
})

const StyledPrimary = styled('span')`
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
const StyledSubtitle = styled('span')`
  font-size: 13px;
  overflow: hidden;
  color: text.secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StyledTypeBox = styled(Box)(({ theme }) => ({
  display: 'inline-block',
  border: '1px solid #ccc',
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  padding: '0 4px',
  lineHeight: 1.5,
  marginRight: '8px',
}))
