import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LanguageRounded } from '@mui/icons-material'
import {
  Box,
  Divider,
  MenuItem,
  Menu,
  Tooltip,
  styled,
  alpha,
} from '@mui/material'
import { UnlistenFn } from '@tauri-apps/api/event'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoading } from '@/components/base'
import { useIconCache } from '@/hooks/use-icon-cache'
import { useListen } from '@/hooks/use-listen'
import { cmdTestDelay } from '@/services/cmds'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import { debugLog } from '@/utils/debug'

import { TestBox } from './test-box'

interface Props {
  id: string
  itemData: IVergeTestItem
  onEdit: () => void
  onDelete: (uid: string) => void
}

export const TestItem = ({
  id,
  itemData,
  onEdit,
  onDelete: removeTest,
}: Props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  })

  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<any>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [delay, setDelay] = useState(-1)
  const [chains, setChains] = useState<string[]>([])
  const { uid, name, icon, url } = itemData
  const iconCachePath = useIconCache({ icon, cacheKey: uid })
  const { addListener } = useListen()

  const onDelay = useCallback(async () => {
    setDelay(-2)
    setChains([])
    const result = await cmdTestDelay(url)
    setDelay(result.delay)
    setChains(result.chains)
  }, [url])

  const onEditTest = () => {
    setAnchorEl(null)
    onEdit()
  }

  const onDelete = useLockFn(async () => {
    setAnchorEl(null)
    try {
      removeTest(uid)
    } catch (err: any) {
      showNotice.error(err)
    }
  })

  const menu = [
    { label: 'Edit', handler: onEditTest },
    { label: 'Delete', handler: onDelete },
  ]

  // mihomo chains: exit node first, top-level group last.
  // chains[0] = actual exit node; chains[last] = top-level group.
  const exitNode = chains[0]
  const isDirect = !exitNode || exitNode === 'DIRECT' || exitNode === 'DIRECT-'
  // top-level group = the outermost selector the user picked (skip DIRECT).
  const group = isDirect
    ? ''
    : ([...chains].reverse().find((n) => n !== 'DIRECT' && n !== 'DIRECT-') ??
      '')
  const showGroup = !!group && group !== exitNode
  const fullChainText = [...chains].reverse().join(' / ')

  useEffect(() => {
    let unlistenFn: UnlistenFn | null = null

    const setupListener = async () => {
      if (unlistenFn) {
        unlistenFn()
      }
      unlistenFn = await addListener('verge://test-all', () => {
        onDelay()
      })
    }

    setupListener()

    return () => {
      if (unlistenFn) {
        debugLog(
          `TestItem for ${id} unmounting or url changed, cleaning up test-all listener.`,
        )
        unlistenFn()
      }
    }
  }, [url, addListener, onDelay, id])

  return (
    <Box
      sx={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined,
      }}
    >
      <TestBox
        onContextMenu={(event) => {
          const { clientX, clientY } = event
          setPosition({ top: clientY, left: clientX })
          setAnchorEl(event.currentTarget)
          event.preventDefault()
        }}
      >
        <Box
          sx={{ position: 'relative', cursor: 'move' }}
          ref={setNodeRef}
          {...attributes}
          {...listeners}
        >
          {icon && icon.trim() !== '' ? (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              {icon.trim().startsWith('http') && (
                <img
                  src={iconCachePath === '' ? icon : iconCachePath}
                  height="40px"
                />
              )}
              {icon.trim().startsWith('data') && (
                <img src={icon} height="40px" />
              )}
              {icon.trim().startsWith('<svg') && (
                <img
                  src={`data:image/svg+xml;base64,${btoa(icon)}`}
                  height="40px"
                />
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <LanguageRounded sx={{ height: '40px' }} fontSize="large" />
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'center' }}>{name}</Box>
        </Box>
        <Divider sx={{ marginTop: '8px' }} />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '8px',
            color: 'primary.main',
          }}
        >
          {delay === -2 && (
            <Widget>
              <BaseLoading />
            </Widget>
          )}

          {delay === -1 && (
            <Widget
              className="the-check"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelay()
              }}
              sx={({ palette }) => ({
                ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
              })}
            >
              {t('tests.components.item.actions.test')}
            </Widget>
          )}

          {delay >= 0 && (
            // 显示延迟
            <Widget
              className="the-delay"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelay()
              }}
              sx={({ palette }) => ({
                color: delayManager.formatDelayColor(delay),
                ':hover': {
                  bgcolor: alpha(palette.primary.main, 0.15),
                },
              })}
            >
              {delayManager.formatDelay(delay)}
            </Widget>
          )}
        </Box>
        {delay >= 0 && exitNode && (
          <Tooltip
            title={isDirect ? '' : fullChainText}
            arrow
            disableHoverListener={isDirect || !fullChainText}
          >
            <Box
              sx={{
                marginTop: '2px',
                minHeight: '40px',
                px: 0.5,
                textAlign: 'center',
                fontSize: 12,
                lineHeight: '18px',
                color: isDirect ? 'text.disabled' : 'text.secondary',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                overflow: 'hidden',
              }}
            >
              {isDirect ? (
                <Box component="span" sx={chainLineSx}>
                  {t('tests.components.item.direct')}
                </Box>
              ) : (
                <>
                  {showGroup && (
                    <Box component="span" sx={chainLineSx}>
                      {group}
                    </Box>
                  )}
                  <Box component="span" sx={chainLineSx}>
                    {exitNode}
                  </Box>
                </>
              )}
            </Box>
          </Tooltip>
        )}
      </TestBox>

      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorPosition={position}
        anchorReference="anchorPosition"
        transitionDuration={225}
        slotProps={{ list: { sx: { py: 0.5 } } }}
        onContextMenu={(e) => {
          setAnchorEl(null)
          e.preventDefault()
        }}
      >
        {menu.map((item) => (
          <MenuItem
            key={item.label}
            onClick={item.handler}
            sx={{ minWidth: 120 }}
            dense
          >
            {t(item.label)}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
const Widget = styled(Box)(({ theme: { typography } }) => ({
  padding: '3px 6px',
  fontSize: 14,
  fontFamily: typography.fontFamily,
  borderRadius: '4px',
}))

const chainLineSx = {
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const
