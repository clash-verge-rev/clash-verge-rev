import { RestartAltRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  styled,
} from '@mui/material'
import { convertFileSrc } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch, TooltipIcon } from '@/components/base'
import { DEFAULT_HOVER_DELAY } from '@/components/proxy/proxy-group-navigator'
import { useVergeConfigField } from '@/hooks/use-verge'
import { useWindowDecorations } from '@/hooks/use-window'
import { copyIconFile, getAppDir } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'

import { GuardState } from './guard-state'
import SettingListItemText from './setting-list-item-text-comp'

const OS = getSystem()

const clampHoverDelay = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_HOVER_DELAY
  }
  return Math.min(5000, Math.max(0, Math.round(value)))
}

const getIcons = async (icon_dir: string, name: string) => {
  const updateTime = localStorage.getItem(`icon_${name}_update_time`) || ''

  const icon_png = await join(icon_dir, `${name}-${updateTime}.png`)
  const icon_ico = await join(icon_dir, `${name}-${updateTime}.ico`)

  return {
    icon_png,
    icon_ico,
  }
}

export const LayoutViewer = forwardRef<DialogRef>((_, ref) => {
  const { t } = useTranslation()
  const trafficGraphField = useVergeConfigField('traffic_graph', true)
  const enableMemoryUsageField = useVergeConfigField(
    'enable_memory_usage',
    true,
  )
  const enableGroupIconField = useVergeConfigField('enable_group_icon', true)
  const pauseRenderTrafficStatsOnBlurField = useVergeConfigField(
    'pause_render_traffic_stats_on_blur',
    true,
  )
  const noticePositionField = useVergeConfigField(
    'notice_position',
    'top-right',
  )
  const enableHoverJumpNavigatorField = useVergeConfigField(
    'enable_hover_jump_navigator',
    true,
  )
  const hoverJumpNavigatorDelayField = useVergeConfigField(
    'hover_jump_navigator_delay',
    DEFAULT_HOVER_DELAY,
  )
  const menuIconField = useVergeConfigField('menu_icon', 'monochrome')
  const collapseNavbarField = useVergeConfigField('collapse_navbar', false)
  const trayIconField = useVergeConfigField('tray_icon', 'monochrome')
  const enableTraySpeedField = useVergeConfigField('enable_tray_speed', false)
  const trayProxyGroupsDisplayModeField = useVergeConfigField(
    'tray_proxy_groups_display_mode',
    'default',
  )
  const trayInlineOutboundModesField = useVergeConfigField(
    'tray_inline_outbound_modes',
    false,
  )
  const commonTrayIconField = useVergeConfigField('common_tray_icon', false)
  const sysproxyTrayIconField = useVergeConfigField('sysproxy_tray_icon', false)
  const tunTrayIconField = useVergeConfigField('tun_tray_icon', false)

  const [open, setOpen] = useState(false)
  const [commonIcon, setCommonIcon] = useState('')
  const [sysproxyIcon, setSysproxyIcon] = useState('')
  const [tunIcon, setTunIcon] = useState('')

  const { decorated, toggleDecorations } = useWindowDecorations()

  useEffect(() => {
    initIconPath()
  }, [])

  async function initIconPath() {
    const appDir = await getAppDir()

    const icon_dir = await join(appDir, 'icons')

    const { icon_png: common_icon_png, icon_ico: common_icon_ico } =
      await getIcons(icon_dir, 'common')

    const { icon_png: sysproxy_icon_png, icon_ico: sysproxy_icon_ico } =
      await getIcons(icon_dir, 'sysproxy')

    const { icon_png: tun_icon_png, icon_ico: tun_icon_ico } = await getIcons(
      icon_dir,
      'tun',
    )

    if (await exists(common_icon_ico)) {
      setCommonIcon(common_icon_ico)
    } else {
      setCommonIcon(common_icon_png)
    }
    if (await exists(sysproxy_icon_ico)) {
      setSysproxyIcon(sysproxy_icon_ico)
    } else {
      setSysproxyIcon(sysproxy_icon_png)
    }
    if (await exists(tun_icon_ico)) {
      setTunIcon(tun_icon_ico)
    } else {
      setTunIcon(tun_icon_png)
    }
  }

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const onSwitchFormat = (_e: any, value: boolean) => value
  const onError = (err: any) => {
    showNotice.error(err)
  }

  return (
    <BaseDialog
      open={open}
      title={
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {t('settings.components.verge.layout.title')}
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={<RestartAltRounded />}
            onClick={() => {
              trafficGraphField.reset()
              enableMemoryUsageField.reset()
              enableGroupIconField.reset()
              pauseRenderTrafficStatsOnBlurField.reset()
              noticePositionField.reset()
              enableHoverJumpNavigatorField.reset()
              hoverJumpNavigatorDelayField.reset()
              menuIconField.reset()
              collapseNavbarField.reset()
              trayIconField.reset()
              enableTraySpeedField.reset()
              trayProxyGroupsDisplayModeField.reset()
              trayInlineOutboundModesField.reset()
              commonTrayIconField.reset()
              sysproxyTrayIconField.reset()
              tunTrayIconField.reset()
            }}
          >
            {t('shared.actions.resetToDefault')}
          </Button>
        </Box>
      }
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t('shared.actions.close')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List>
        <Item>
          <ListItemText
            primary={t(
              'settings.components.verge.layout.fields.preferSystemTitlebar',
            )}
          />
          <GuardState
            value={decorated}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={async () => {
              await toggleDecorations()
            }}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.trafficGraph')}
            modified={trafficGraphField.modified}
          />
          <GuardState
            value={trafficGraphField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={trafficGraphField.mutate}
            onGuard={trafficGraphField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.memoryUsage')}
            modified={enableMemoryUsageField.modified}
          />
          <GuardState
            value={enableMemoryUsageField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={enableMemoryUsageField.mutate}
            onGuard={enableMemoryUsageField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.proxyGroupIcon')}
            modified={enableGroupIconField.modified}
          />
          <GuardState
            value={enableGroupIconField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={enableGroupIconField.mutate}
            onGuard={enableGroupIconField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t(
              'settings.components.verge.layout.fields.pauseRenderTrafficStatsOnBlur',
            )}
            modified={pauseRenderTrafficStatsOnBlurField.modified}
          />
          <GuardState
            value={pauseRenderTrafficStatsOnBlurField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={pauseRenderTrafficStatsOnBlurField.mutate}
            onGuard={pauseRenderTrafficStatsOnBlurField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.toastPosition')}
            modified={noticePositionField.modified}
          />
          <GuardState
            value={noticePositionField.value}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={noticePositionField.mutate}
            onGuard={noticePositionField.patch}
          >
            <Select size="small" sx={{ width: 180, '> div': { py: '7.5px' } }}>
              <MenuItem value="top-right">
                {t(
                  'settings.components.verge.layout.options.toastPosition.topRight',
                )}
              </MenuItem>
              <MenuItem value="top-left">
                {t(
                  'settings.components.verge.layout.options.toastPosition.topLeft',
                )}
              </MenuItem>
              <MenuItem value="bottom-right">
                {t(
                  'settings.components.verge.layout.options.toastPosition.bottomRight',
                )}
              </MenuItem>
              <MenuItem value="bottom-left">
                {t(
                  'settings.components.verge.layout.options.toastPosition.bottomLeft',
                )}
              </MenuItem>
            </Select>
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.hoverNavigator')}
            modified={enableHoverJumpNavigatorField.modified}
            extra={
              <TooltipIcon
                title={t(
                  'settings.components.verge.layout.tooltips.hoverNavigator',
                )}
                sx={{ opacity: '0.7' }}
              />
            }
          />
          <GuardState
            value={enableHoverJumpNavigatorField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={enableHoverJumpNavigatorField.mutate}
            onGuard={enableHoverJumpNavigatorField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t(
              'settings.components.verge.layout.fields.hoverNavigatorDelay',
            )}
            modified={hoverJumpNavigatorDelayField.modified}
            extra={
              <TooltipIcon
                title={t(
                  'settings.components.verge.layout.tooltips.hoverNavigatorDelay',
                )}
                sx={{ opacity: '0.7' }}
              />
            }
          />
          <GuardState
            value={hoverJumpNavigatorDelayField.value}
            waitTime={400}
            onCatch={onError}
            onFormat={(e: any) => clampHoverDelay(Number(e.target.value))}
            onChange={hoverJumpNavigatorDelayField.mutate}
            onGuard={hoverJumpNavigatorDelayField.patch}
          >
            <TextField
              type="number"
              size="small"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              sx={{ width: 120 }}
              disabled={!enableHoverJumpNavigatorField.value}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t('shared.units.milliseconds')}
                    </InputAdornment>
                  ),
                },
                htmlInput: {
                  min: 0,
                  max: 5000,
                  step: 20,
                },
              }}
            />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.navIcon')}
            modified={menuIconField.modified}
          />
          <GuardState
            value={menuIconField.value}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={menuIconField.mutate}
            onGuard={menuIconField.patch}
          >
            <Select size="small" sx={{ width: 140, '> div': { py: '7.5px' } }}>
              <MenuItem value="monochrome">
                {t('settings.components.verge.layout.options.icon.monochrome')}
              </MenuItem>
              <MenuItem value="colorful">
                {t('settings.components.verge.layout.options.icon.colorful')}
              </MenuItem>
              <MenuItem value="disable">
                {t('settings.components.verge.layout.options.icon.disable')}
              </MenuItem>
            </Select>
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.collapseNavBar')}
            modified={collapseNavbarField.modified}
          />
          <GuardState
            value={collapseNavbarField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={collapseNavbarField.mutate}
            onGuard={collapseNavbarField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        {OS === 'macos' && (
          <Item>
            <SettingListItemText
              label={t('settings.components.verge.layout.fields.trayIcon')}
              modified={trayIconField.modified}
            />
            <GuardState
              value={trayIconField.value}
              onCatch={onError}
              onFormat={(e: any) => e.target.value}
              onChange={trayIconField.mutate}
              onGuard={trayIconField.patch}
            >
              <Select
                size="small"
                sx={{ width: 140, '> div': { py: '7.5px' } }}
              >
                <MenuItem value="monochrome">
                  {t(
                    'settings.components.verge.layout.options.icon.monochrome',
                  )}
                </MenuItem>
                <MenuItem value="colorful">
                  {t('settings.components.verge.layout.options.icon.colorful')}
                </MenuItem>
              </Select>
            </GuardState>
          </Item>
        )}
        {OS === 'macos' && (
          <Item>
            <SettingListItemText
              label={t(
                'settings.components.verge.layout.fields.enableTraySpeed',
              )}
              modified={enableTraySpeedField.modified}
            />
            <GuardState
              value={enableTraySpeedField.value}
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={enableTraySpeedField.mutate}
              onGuard={enableTraySpeedField.patch}
            >
              <Switch edge="end" />
            </GuardState>
          </Item>
        )}
        {/* {OS === "macos" && (
          <Item>
            <ListItemText primary={t("settings.components.verge.layout.fields.enableTrayIcon")} />
            <GuardState
              value={
                verge?.enable_tray_icon === false &&
                verge?.enable_tray_speed === false
                  ? true
                  : (verge?.enable_tray_icon ?? true)
              }
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={(e) => onChangeData({ enable_tray_icon: e })}
              onGuard={(e) => patchVerge({ enable_tray_icon: e })}
            >
              <Switch edge="end" />
            </GuardState>
          </Item>
        )} */}
        <Item>
          <SettingListItemText
            label={t(
              'settings.components.verge.layout.fields.proxyGroupsDisplayMode',
            )}
            modified={trayProxyGroupsDisplayModeField.modified}
          />
          <GuardState
            value={trayProxyGroupsDisplayModeField.value}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={trayProxyGroupsDisplayModeField.mutate}
            onGuard={trayProxyGroupsDisplayModeField.patch}
          >
            <Select size="small" sx={{ width: 140, '> div': { py: '7.5px' } }}>
              <MenuItem value="default">
                {t(
                  'settings.components.verge.layout.options.proxyGroupsDisplayMode.default',
                )}
              </MenuItem>
              <MenuItem value="inline">
                {t(
                  'settings.components.verge.layout.options.proxyGroupsDisplayMode.inline',
                )}
              </MenuItem>
              <MenuItem value="disable">
                {t(
                  'settings.components.verge.layout.options.proxyGroupsDisplayMode.disable',
                )}
              </MenuItem>
            </Select>
          </GuardState>
        </Item>
        <Item>
          <SettingListItemText
            label={t(
              'settings.components.verge.layout.fields.showOutboundModesInline',
            )}
            modified={trayInlineOutboundModesField.modified}
          />
          <GuardState
            value={trayInlineOutboundModesField.value}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={trayInlineOutboundModesField.mutate}
            onGuard={trayInlineOutboundModesField.patch}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.commonTrayIcon')}
            modified={commonTrayIconField.modified}
          />
          <GuardState
            value={commonTrayIconField.value}
            onCatch={onError}
            onChange={commonTrayIconField.mutate}
            onGuard={commonTrayIconField.patch}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={
                commonTrayIconField.value &&
                commonIcon && (
                  <img height="20px" src={convertFileSrc(commonIcon)} />
                )
              }
              onClick={async () => {
                if (commonTrayIconField.value) {
                  commonTrayIconField.mutate(false)
                  commonTrayIconField.patch(false)
                } else {
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: 'Tray Icon Image',
                        extensions: ['png', 'ico'],
                      },
                    ],
                  })

                  if (selected) {
                    await copyIconFile(`${selected}`, 'common')
                    await initIconPath()
                    commonTrayIconField.mutate(true)
                    commonTrayIconField.patch(true)
                  }
                }
              }}
            >
              {commonTrayIconField.value
                ? t('shared.actions.clear')
                : t('settings.components.verge.basic.actions.browse')}
            </Button>
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t(
              'settings.components.verge.layout.fields.systemProxyTrayIcon',
            )}
            modified={sysproxyTrayIconField.modified}
          />
          <GuardState
            value={sysproxyTrayIconField.value}
            onCatch={onError}
            onChange={sysproxyTrayIconField.mutate}
            onGuard={sysproxyTrayIconField.patch}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={
                sysproxyTrayIconField.value &&
                sysproxyIcon && (
                  <img height="20px" src={convertFileSrc(sysproxyIcon)} />
                )
              }
              onClick={async () => {
                if (sysproxyTrayIconField.value) {
                  sysproxyTrayIconField.mutate(false)
                  sysproxyTrayIconField.patch(false)
                } else {
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: 'Tray Icon Image',
                        extensions: ['png', 'ico'],
                      },
                    ],
                  })
                  if (selected) {
                    await copyIconFile(`${selected}`, 'sysproxy')
                    await initIconPath()
                    sysproxyTrayIconField.mutate(true)
                    sysproxyTrayIconField.patch(true)
                  }
                }
              }}
            >
              {sysproxyTrayIconField.value
                ? t('shared.actions.clear')
                : t('settings.components.verge.basic.actions.browse')}
            </Button>
          </GuardState>
        </Item>

        <Item>
          <SettingListItemText
            label={t('settings.components.verge.layout.fields.tunTrayIcon')}
            modified={tunTrayIconField.modified}
          />
          <GuardState
            value={tunTrayIconField.value}
            onCatch={onError}
            onChange={tunTrayIconField.mutate}
            onGuard={tunTrayIconField.patch}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={
                tunTrayIconField.value &&
                tunIcon && <img height="20px" src={convertFileSrc(tunIcon)} />
              }
              onClick={async () => {
                if (tunTrayIconField.value) {
                  tunTrayIconField.mutate(false)
                  tunTrayIconField.patch(false)
                } else {
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: 'Tun Icon Image',
                        extensions: ['png', 'ico'],
                      },
                    ],
                  })
                  if (selected) {
                    await copyIconFile(`${selected}`, 'tun')
                    await initIconPath()
                    tunTrayIconField.mutate(true)
                    tunTrayIconField.patch(true)
                  }
                }
              }}
            >
              {tunTrayIconField.value
                ? t('shared.actions.clear')
                : t('settings.components.verge.basic.actions.browse')}
            </Button>
          </GuardState>
        </Item>
      </List>
    </BaseDialog>
  )
})

const Item = styled(ListItem)(() => ({
  padding: '5px 2px',
}))
