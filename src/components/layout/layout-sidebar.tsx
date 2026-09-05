import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { Box, List, Menu, MenuItem, SvgIcon } from '@mui/material'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import iconDark from '@/assets/image/icon_dark.svg?react'
import iconLight from '@/assets/image/icon_light.svg?react'
import LogoSvg from '@/assets/image/logo.svg?react'
import { useVerge } from '@/hooks/use-verge'
import { useNavMenuOrder } from '@/pages/_layout/hooks'
import { navItems } from '@/pages/_navigation'

import { SortableItem } from '../base'

import { LayoutItem } from './layout-item'
import { LayoutTraffic } from './layout-traffic'
import { UpdateButton } from './update-button'

type MenuContextPosition = { top: number; left: number }

interface LayoutSidebarProps {
  isDark: boolean
  isCollapsed: boolean
}

const SENSORS = [PointerSensor, KeyboardSensor]

export const LayoutSidebar = (props: LayoutSidebarProps) => {
  const { isDark, isCollapsed } = props
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const [menuUnlocked, setMenuUnlocked] = useState(false)
  const [menuContextPosition, setMenuContextPosition] =
    useState<MenuContextPosition | null>(null)

  const handleMenuOrderOptimisticUpdate = useCallback(
    (order: string[]) => {
      mutateVerge(
        (prev) => (prev ? { ...prev, menu_order: order } : prev),
        false,
      )
    },
    [mutateVerge],
  )

  const handleMenuOrderPersist = useCallback(
    (order: string[]) => patchVerge({ menu_order: order }),
    [patchVerge],
  )

  const {
    menuOrder,
    navItemMap,
    handleMenuDragEnd,
    isDefaultOrder,
    resetMenuOrder,
  } = useNavMenuOrder({
    enabled: menuUnlocked,
    items: navItems,
    storedOrder: verge?.menu_order,
    onOptimisticUpdate: handleMenuOrderOptimisticUpdate,
    onPersist: handleMenuOrderPersist,
  })

  const handleMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setMenuContextPosition({ top: event.clientY, left: event.clientX })
    },
    [],
  )

  const handleMenuContextClose = useCallback(() => {
    setMenuContextPosition(null)
  }, [])

  const handleResetMenuOrder = useCallback(() => {
    setMenuContextPosition(null)
    void resetMenuOrder()
  }, [resetMenuOrder])

  const handleUnlockMenu = useCallback(() => {
    setMenuUnlocked(true)
    setMenuContextPosition(null)
  }, [])

  const handleLockMenu = useCallback(() => {
    setMenuUnlocked(false)
    setMenuContextPosition(null)
  }, [])

  const handleToggleNavCollapsed = useCallback(() => {
    setMenuContextPosition(null)
    void patchVerge({ collapse_navbar: !isCollapsed })
  }, [isCollapsed, patchVerge])

  // Navigation menu items
  const navMenuItems = menuOrder.map((path, index) => {
    const item = navItemMap.get(path)
    if (!item) return null

    return (
      <SortableItem
        key={item.path}
        id={item.path}
        index={index}
        disabled={!menuUnlocked}
      >
        {(sortable) => (
          <LayoutItem to={item.path} icon={item.icon} sortable={sortable}>
            {t(item.label)}
          </LayoutItem>
        )}
      </SortableItem>
    )
  })

  return (
    <div className="layout-content__left">
      {/* Logo */}
      <div className="the-logo" data-tauri-drag-region="false">
        <div
          data-tauri-drag-region="true"
          style={{
            height: '27px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <SvgIcon
            component={isDark ? iconDark : iconLight}
            style={{
              height: '36px',
              width: '36px',
              marginTop: '-3px',
              marginRight: '5px',
              marginLeft: '-3px',
            }}
            inheritViewBox
          />
          <LogoSvg fill={isDark ? 'white' : 'black'} />
        </div>
        <UpdateButton className="the-newbtn" />
      </div>

      {/* Edit navigation menu badge */}
      {menuUnlocked && (
        <Box
          sx={(theme) => ({
            px: 1.5,
            py: 0.75,
            mx: 'auto',
            mb: 1,
            maxWidth: 250,
            borderRadius: 1.5,
            fontSize: 12,
            fontWeight: 600,
            textAlign: 'center',
            color: theme.palette.warning.contrastText,
            bgcolor:
              theme.palette.mode === 'light'
                ? theme.palette.warning.main
                : theme.palette.warning.dark,
          })}
        >
          {t('layout.components.navigation.menu.reorderMode')}
        </Box>
      )}

      {/* Navigation menu */}
      <List className="the-menu" onContextMenu={handleMenuContextMenu}>
        <DragDropProvider sensors={SENSORS} onDragEnd={handleMenuDragEnd}>
          {navMenuItems}
        </DragDropProvider>
      </List>

      {/* Context menu */}
      <Menu
        open={Boolean(menuContextPosition)}
        onClose={handleMenuContextClose}
        anchorReference="anchorPosition"
        anchorPosition={
          menuContextPosition
            ? {
                top: menuContextPosition.top,
                left: menuContextPosition.left,
              }
            : undefined
        }
        transitionDuration={200}
        slotProps={{
          list: {
            sx: { py: 0.5 },
          },
        }}
      >
        <MenuItem onClick={handleToggleNavCollapsed} dense>
          {isCollapsed
            ? t('layout.components.navigation.menu.expandNavBar')
            : t('layout.components.navigation.menu.collapseNavBar')}
        </MenuItem>
        <MenuItem
          onClick={menuUnlocked ? handleLockMenu : handleUnlockMenu}
          dense
        >
          {menuUnlocked
            ? t('layout.components.navigation.menu.lock')
            : t('layout.components.navigation.menu.unlock')}
        </MenuItem>
        <MenuItem
          onClick={handleResetMenuOrder}
          dense
          disabled={isDefaultOrder}
        >
          {t('layout.components.navigation.menu.restoreDefaultOrder')}
        </MenuItem>
      </Menu>

      {/* Traffic */}
      <div className="the-traffic">
        <LayoutTraffic />
      </div>
    </div>
  )
}
