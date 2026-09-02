import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import {
  Box,
  List,
  Menu,
  MenuItem,
  Paper,
  SvgIcon,
  ThemeProvider,
} from '@mui/material'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useNavigate } from 'react-router'

import iconDark from '@/assets/image/icon_dark.svg?react'
import iconLight from '@/assets/image/icon_light.svg?react'
import LogoSvg from '@/assets/image/logo.svg?react'
import { BaseErrorBoundary, SortableItem } from '@/components/base'
import { LayoutItem } from '@/components/layout/layout-item'
import { LayoutTraffic } from '@/components/layout/layout-traffic'
import { NoticeManager } from '@/components/layout/notice-manager'
import { ServiceMigrationDialog } from '@/components/layout/service-migration-dialog'
import { SysproxyPrivilegeDialog } from '@/components/layout/sysproxy-privilege-dialog'
import { UpdateButton } from '@/components/layout/update-button'
import {
  WindowControls,
  WindowResizeHandles,
} from '@/components/layout/window-controller'
import { useI18n } from '@/hooks/use-i18n'
import { useVerge } from '@/hooks/use-verge'
import { useWindowDecorations } from '@/hooks/use-window'
import { useThemeMode } from '@/services/states'
import getSystem from '@/utils/get-system'

import {
  useCustomTheme,
  useLayoutEvents,
  useLoadingOverlay,
  useNavMenuOrder,
  usePendingFailures,
} from './_layout/hooks'
import { handleNoticeMessage } from './_layout/utils'
import { navItems } from './_navigation'

import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'

type MenuContextPosition = { top: number; left: number }

dayjs.extend(relativeTime)

const OS = getSystem()
const SENSORS = [PointerSensor, KeyboardSensor]

const Layout = () => {
  const mode = useThemeMode()
  const isDark = mode !== 'light'
  const { t } = useTranslation()
  const { theme } = useCustomTheme()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { language } = verge ?? {}
  const navCollapsed = verge?.collapse_navbar ?? false
  const { switchLanguage } = useI18n()
  const navigate = useNavigate()
  const themeReady = useMemo(() => Boolean(theme), [theme])

  const [menuUnlocked, setMenuUnlocked] = useState(false)
  const [menuContextPosition, setMenuContextPosition] =
    useState<MenuContextPosition | null>(null)

  const windowControlsRef = useRef<any>(null)
  const { decorated } = useWindowDecorations()

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
    void patchVerge({ collapse_navbar: !navCollapsed })
  }, [navCollapsed, patchVerge])

  const customTitlebar = useMemo(
    () =>
      decorated === false ? (
        <div className="the_titlebar">
          <div
            className="the_titlebar-drag-region"
            data-tauri-drag-region="true"
          />
          <WindowControls ref={windowControlsRef} />
        </div>
      ) : null,
    [decorated],
  )

  useLoadingOverlay(themeReady)

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload
      try {
        handleNoticeMessage(status, msg, t, navigate)
      } catch (error) {
        console.error('[通知处理] 失败:', error)
      }
    },
    [t, navigate],
  )

  useLayoutEvents(handleNotice)
  usePendingFailures()

  useEffect(() => {
    if (language) {
      dayjs.locale(language === 'zh' ? 'zh-cn' : language)
      switchLanguage(language)
    }
  }, [language, switchLanguage])

  if (!themeReady) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: mode === 'light' ? '#fff' : '#181a1b',
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: mode === 'light' ? '#333' : '#fff',
        }}
      ></div>
    )
  }

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
    <ThemeProvider theme={theme}>
      {/* 左侧底部窗口控制按钮 */}
      <NoticeManager position={verge?.notice_position} />
      <ServiceMigrationDialog />
      <SysproxyPrivilegeDialog />
      <div
        style={{
          animation: 'fadeIn 0.5s',
          WebkitAnimation: 'fadeIn 0.5s',
        }}
      />
      <style>
        {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}
      </style>
      <Paper
        square
        elevation={0}
        className={`${OS} layout${navCollapsed ? ' layout--nav-collapsed' : ''}`}
        style={{
          borderTopLeftRadius: '0px',
          borderTopRightRadius: '0px',
        }}
        onContextMenu={(e) => {
          if (
            OS === 'windows' &&
            !['input', 'textarea'].includes(
              e.currentTarget.tagName.toLowerCase(),
            ) &&
            !e.currentTarget.isContentEditable
          ) {
            e.preventDefault()
          }
        }}
        sx={[
          ({ palette }) => ({ bgcolor: palette.background.paper }),
          OS === 'linux'
            ? {
                borderRadius: '8px',
                width: '100vw',
                height: '100vh',
              }
            : {},
        ]}
      >
        {decorated === false && <WindowResizeHandles />}

        {/* Custom titlebar - rendered only when decorated is false, memoized for performance */}
        {customTitlebar}

        <div className="layout-content">
          <div className="layout-content__left">
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
                {navCollapsed
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

            <div className="the-traffic">
              <LayoutTraffic />
            </div>
          </div>

          <div className="layout-content__right">
            <div className="the-bar"></div>
            <div className="the-content">
              <BaseErrorBoundary>
                <Outlet />
              </BaseErrorBoundary>
            </div>
          </div>
        </div>
      </Paper>
    </ThemeProvider>
  )
}

export default Layout
