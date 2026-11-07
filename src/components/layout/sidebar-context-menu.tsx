import { Menu, MenuItem } from '@mui/material'
import { useTranslation } from 'react-i18next'

interface ContextMenuItem {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
}

interface SidebarContextMenuProps {
  // Menu visibility/position
  position: { top: number; left: number } | null
  onClose: () => void

  // Sidebar controls
  isSidebarCollapsed: boolean
  onToggleSidebar: () => void

  // Navigation order controls
  isMenuOrderUnlocked: boolean
  isMenuOrderDefault: boolean
  onToggleMenuLock: () => void
  onResetMenuOrder: () => void
}

/**
 * Context menu for sidebar actions.
 */
export const SidebarContextMenu = (props: SidebarContextMenuProps) => {
  const {
    position,
    onClose,
    isSidebarCollapsed,
    onToggleSidebar,
    isMenuOrderUnlocked,
    isMenuOrderDefault,
    onToggleMenuLock,
    onResetMenuOrder,
  } = props

  const { t } = useTranslation()

  const menuItems: ContextMenuItem[] = [
    {
      key: 'toggle-sidebar',
      label: isSidebarCollapsed
        ? t('layout.components.navigation.menu.expandNavBar')
        : t('layout.components.navigation.menu.collapseNavBar'),
      onClick: onToggleSidebar,
    },
    {
      key: 'toggle-menu-lock',
      label: isMenuOrderUnlocked
        ? t('layout.components.navigation.menu.lock')
        : t('layout.components.navigation.menu.unlock'),
      onClick: onToggleMenuLock,
    },
    {
      key: 'reset-menu-order',
      label: t('layout.components.navigation.menu.restoreDefaultOrder'),
      onClick: onResetMenuOrder,
      disabled: isMenuOrderDefault,
    },
  ]

  return (
    <Menu
      open={Boolean(position)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={position ?? undefined}
      transitionDuration={200}
      slotProps={{ list: { sx: { py: 0.5 } } }}
    >
      {menuItems.map(({ key, label, onClick, disabled }) => (
        <MenuItem key={key} onClick={onClick} disabled={disabled} dense>
          {label}
        </MenuItem>
      ))}
    </Menu>
  )
}
