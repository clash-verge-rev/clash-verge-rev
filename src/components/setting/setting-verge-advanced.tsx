import { ContentCopyRounded } from '@mui/icons-material'
import { Typography } from '@mui/material'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogRef, TooltipIcon } from '@/components/base'
import { updateLastCheckTime } from '@/hooks/use-update'
import {
  exitApp,
  exportDiagnosticInfo,
  openAppDir,
  openCoreDir,
  openDevTools,
  openLogsDir,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import { checkUpdateSafe as checkUpdate } from '@/services/update'
import { version } from '@root/package.json'

import { BackupViewer } from './mods/backup-viewer'
import { ConfigViewer } from './mods/config-viewer'
import { HotkeyViewer } from './mods/hotkey-viewer'
import { LayoutViewer } from './mods/layout-viewer'
import { LiteModeViewer } from './mods/lite-mode-viewer'
import { MiscViewer } from './mods/misc-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'
import { ThemeViewer } from './mods/theme-viewer'
import { UpdateViewer, type UpdateViewerRef } from './mods/update-viewer'

interface Props {
  onError?: (err: Error) => void
}

const SettingVergeAdvanced = ({ onError: _ }: Props) => {
  const { t } = useTranslation()

  const configRef = useRef<DialogRef>(null)
  const hotkeyRef = useRef<DialogRef>(null)
  const miscRef = useRef<DialogRef>(null)
  const themeRef = useRef<DialogRef>(null)
  const layoutRef = useRef<DialogRef>(null)
  const updateRef = useRef<UpdateViewerRef>(null)
  const backupRef = useRef<DialogRef>(null)
  const liteModeRef = useRef<DialogRef>(null)

  const onCheckUpdate = async () => {
    try {
      const info = await checkUpdate()
      updateLastCheckTime()
      if (!info?.available) {
        showNotice.success(
          'settings.components.verge.advanced.notifications.latestVersion',
        )
      } else {
        updateRef.current?.open(info)
      }
    } catch (err) {
      console.warn('update check failed:', err)
      showNotice.warning(err)
    }
  }

  const onExportDiagnosticInfo = useCallback(async () => {
    await mutate(() => exportDiagnosticInfo(), {
      id: 'export-diagnostic-info',
      errorNotice: false,
    })
    showNotice.success('shared.feedback.notifications.common.copySuccess', 1000)
  }, [])

  const copyVersion = useCallback(() => {
    navigator.clipboard.writeText(`v${version}`).then(() => {
      showNotice.success(
        'settings.components.verge.advanced.notifications.versionCopied',
        1000,
      )
    })
  }, [])

  return (
    <SettingList title={t('settings.components.verge.advanced.title')}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <UpdateViewer ref={updateRef} />
      <BackupViewer ref={backupRef} />
      <LiteModeViewer ref={liteModeRef} />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.backupSetting"
        onClick={() => backupRef.current?.open()}
        label={t('settings.components.verge.advanced.fields.backupSetting')}
        extra={
          <TooltipIcon
            title={t('settings.components.verge.advanced.tooltips.backupInfo')}
            sx={{ opacity: '0.7' }}
          />
        }
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.runtimeConfig"
        onClick={() => configRef.current?.open()}
        label={t('settings.components.verge.advanced.fields.runtimeConfig')}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.openConfDir"
        onClick={openAppDir}
        label={t('settings.components.verge.advanced.fields.openConfDir')}
        extra={
          <TooltipIcon
            title={t('settings.components.verge.advanced.tooltips.openConfDir')}
            sx={{ opacity: '0.7' }}
          />
        }
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.openCoreDir"
        onClick={openCoreDir}
        label={t('settings.components.verge.advanced.fields.openCoreDir')}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.openLogsDir"
        onClick={openLogsDir}
        label={t('settings.components.verge.advanced.fields.openLogsDir')}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.checkUpdates"
        onClick={onCheckUpdate}
        label={t('settings.components.verge.advanced.fields.checkUpdates')}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.openDevTools"
        onClick={() => {
          void mutate(() => openDevTools(), {
            id: 'open-devtools',
            errorNotice: false,
          }).catch(() => {})
        }}
        label={t('settings.components.verge.advanced.fields.openDevTools')}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.liteModeSettings"
        label={t('settings.components.verge.advanced.fields.liteModeSettings')}
        extra={
          <TooltipIcon
            title={t('settings.components.verge.advanced.tooltips.liteMode')}
            sx={{ opacity: '0.7' }}
          />
        }
        onClick={() => liteModeRef.current?.open()}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.exit"
        onClick={() => {
          void mutate(() => exitApp(), {
            id: 'exit-app',
            errorNotice: false,
          }).catch(() => {})
        }}
        label={t('settings.components.verge.advanced.fields.exit')}
      />

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.exportDiagnostics"
        label={t('settings.components.verge.advanced.fields.exportDiagnostics')}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={onExportDiagnosticInfo}
          />
        }
      ></SettingItem>

      <SettingItem
        data-setting-target="settings.components.verge.advanced.fields.vergeVersion"
        label={t('settings.components.verge.advanced.fields.vergeVersion')}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={copyVersion}
            title={t('settings.components.verge.advanced.actions.copyVersion')}
          />
        }
      >
        <Typography sx={{ py: '7px', pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  )
}

export default SettingVergeAdvanced
