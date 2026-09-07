import { LanguageRounded } from '@mui/icons-material'
import { Box, Divider, MenuItem, Menu, styled, alpha } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoading } from '@/components/base'
import { useIconCache } from '@/hooks/use-icon-cache'
import { cmdTestDelay } from '@/services/cmds'
import delayManager from '@/services/delay'
import { subscribeVergeEvents } from '@/services/events'
import { showNotice } from '@/services/notice-service'

import { TestBox } from './test-box'

interface Props {
  itemData: IVergeTestItem
  onEdit: () => void
  onDelete: (uid: string) => void
}

export const TestItem = ({ itemData, onEdit, onDelete: removeTest }: Props) => {
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<any>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [delay, setDelay] = useState(-1)
  const { uid, name, icon, url } = itemData
  const iconCachePath = useIconCache({ icon, cacheKey: uid })

  const onDelay = useCallback(async () => {
    setDelay(-2)
    const result = await cmdTestDelay(url)
    setDelay(result)
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
    { label: t('shared.actions.edit'), handler: onEditTest },
    { label: t('shared.actions.delete'), handler: onDelete },
  ]

  useEffect(
    () => subscribeVergeEvents({ 'verge://test-all': () => onDelay() }),
    [url, onDelay],
  )

  return (
    <Box>
      <TestBox
        onContextMenu={(event) => {
          const { clientX, clientY } = event
          setPosition({ top: clientY, left: clientX })
          setAnchorEl(event.currentTarget)
          event.preventDefault()
        }}
      >
        <Box data-sortable-handle sx={{ position: 'relative', cursor: 'move' }}>
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
            {item.label}
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
