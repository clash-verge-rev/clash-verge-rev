import { LanRounded, SettingsRounded } from '@mui/icons-material'
import { MenuItem, Select, TextField, Typography } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { updateGeo, type LogLevel } from 'tauri-plugin-mihomo-api'

import { DialogRef, Switch, TooltipIcon } from '@/components/base'
import { useClash, useClashConfigField } from '@/hooks/use-clash'
import { useClashLog } from '@/hooks/use-clash-log'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import {
  useCachedVergeConfigField,
  useVerge,
  useVergeConfigField,
} from '@/hooks/use-verge'
import { invoke_uwp_tool } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'

import { ClashCoreViewer } from './mods/clash-core-viewer'
import { ClashPortViewer } from './mods/clash-port-viewer'
import { ControllerViewer } from './mods/controller-viewer'
import { DnsViewer } from './mods/dns-viewer'
import { HeaderConfiguration } from './mods/external-controller-cors'
import { GuardState } from './mods/guard-state'
import { NetworkInterfaceViewer } from './mods/network-interface-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'
import { TunnelsViewer } from './mods/tunnels-viewer'
import { WebUIViewer } from './mods/web-ui-viewer'

const isWIN = getSystem() === 'windows'

interface Props {
  onError: (err: Error) => void
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation()

  const { version, mutateClash } = useClash()
  const { patchVerge } = useVerge()
  const displayedMixedPort = useDisplayedMixedPort()
  const [, setClashLog] = useClashLog()

  const allowLanField = useClashConfigField('allow-lan', false)
  const ipv6Field = useClashConfigField('ipv6', false)
  const unifiedDelayField = useClashConfigField('unified-delay', false)
  const logLevelField = useClashConfigField('log-level', 'info')

  const dnsSettingsCachedField = useCachedVergeConfigField(
    'enable_dns_settings',
    false,
  )
  const mixedPortField = useVergeConfigField('verge_mixed_port', 7897)
  const socksPortField = useVergeConfigField('verge_socks_port', 7898)
  const socksEnabledField = useVergeConfigField('verge_socks_enabled', false)
  const httpPortField = useVergeConfigField('verge_port', 7899)
  const httpEnabledField = useVergeConfigField('verge_http_enabled', false)
  const redirPortField = useVergeConfigField('verge_redir_port', 7895)
  const redirEnabledField = useVergeConfigField('verge_redir_enabled', false)
  const tproxyPortField = useVergeConfigField('verge_tproxy_port', 7896)
  const tproxyEnabledField = useVergeConfigField('verge_tproxy_enabled', false)

  const webRef = useRef<DialogRef>(null)
  const portRef = useRef<DialogRef>(null)
  const ctrlRef = useRef<DialogRef>(null)
  const coreRef = useRef<DialogRef>(null)
  const networkRef = useRef<DialogRef>(null)
  const dnsRef = useRef<DialogRef>(null)
  const corsRef = useRef<DialogRef>(null)
  const tunnelRef = useRef<DialogRef>(null)

  const onSwitchFormat = (_e: any, value: boolean) => value
  const onUpdateGeo = async () => {
    try {
      await updateGeo()
      showNotice.success('settings.feedback.notifications.clash.geoDataUpdated')
    } catch (err: any) {
      showNotice.error(err)
    }
  }

  // 实现DNS设置开关处理函数
  const handleDnsToggle = useLockFn(async (enable: boolean) => {
    try {
      dnsSettingsCachedField.set(enable)
      await patchVerge({ enable_dns_settings: enable })
      await invoke('apply_dns_config', { apply: enable })
      setTimeout(() => {
        mutateClash()
      }, 500)
    } catch (err: any) {
      dnsSettingsCachedField.set(!enable)
      showNotice.error(err)
      await patchVerge({ enable_dns_settings: !enable }).catch(() => {})
      throw err
    }
  })

  return (
    <SettingList title={t('settings.sections.clash.title')}>
      <WebUIViewer ref={webRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />
      <ClashCoreViewer ref={coreRef} />
      <NetworkInterfaceViewer ref={networkRef} />
      <DnsViewer ref={dnsRef} />
      <HeaderConfiguration ref={corsRef} />
      <TunnelsViewer ref={tunnelRef} />
      <SettingItem
        label={t('settings.sections.clash.form.fields.allowLan')}
        extra={
          <TooltipIcon
            title={t('settings.sections.clash.form.tooltips.networkInterface')}
            color={'inherit'}
            icon={LanRounded}
            onClick={() => {
              networkRef.current?.open()
            }}
          />
        }
        modified={allowLanField.modified}
      >
        <GuardState
          value={allowLanField.value}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={allowLanField.mutate}
          onGuard={allowLanField.patch}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.dnsOverwrite')}
        extra={
          <TooltipIcon
            icon={SettingsRounded}
            onClick={() => dnsRef.current?.open()}
          />
        }
        modified={dnsSettingsCachedField.modified}
      >
        <Switch
          edge="end"
          checked={dnsSettingsCachedField.value}
          onChange={(_, checked) => handleDnsToggle(checked)}
        />
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.ipv6')}
        modified={ipv6Field.modified}
      >
        <GuardState
          value={ipv6Field.value}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={ipv6Field.mutate}
          onGuard={ipv6Field.patch}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.unifiedDelay')}
        extra={
          <TooltipIcon
            title={t('settings.sections.clash.form.tooltips.unifiedDelay')}
            sx={{ opacity: '0.7' }}
          />
        }
        modified={unifiedDelayField.modified}
      >
        <GuardState
          value={unifiedDelayField.value}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={unifiedDelayField.mutate}
          onGuard={unifiedDelayField.patch}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.logLevel')}
        extra={
          <TooltipIcon
            title={t('settings.sections.clash.form.tooltips.logLevel')}
            sx={{ opacity: '0.7' }}
          />
        }
        modified={logLevelField.modified}
      >
        <GuardState
          value={
            logLevelField.value === 'warn' ? 'warning' : logLevelField.value
          }
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={logLevelField.mutate}
          onGuard={(e) => {
            setClashLog((pre) => ({
              ...pre!,
              logLevel: e.toUpperCase() as LogLevel,
            }))
            return logLevelField.patch(e)
          }}
        >
          <Select size="small" sx={{ width: 100, '> div': { py: '7.5px' } }}>
            <MenuItem value="debug">
              {t('settings.sections.clash.form.options.logLevel.debug')}
            </MenuItem>
            <MenuItem value="info">
              {t('settings.sections.clash.form.options.logLevel.info')}
            </MenuItem>
            <MenuItem value="warning">
              {t('settings.sections.clash.form.options.logLevel.warning')}
            </MenuItem>
            <MenuItem value="error">
              {t('settings.sections.clash.form.options.logLevel.error')}
            </MenuItem>
            <MenuItem value="silent">
              {t('settings.sections.clash.form.options.logLevel.silent')}
            </MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.portConfig')}
        modified={
          mixedPortField.modified ||
          (socksEnabledField.value && socksPortField.modified) ||
          socksEnabledField.modified ||
          (httpEnabledField.value && httpPortField.modified) ||
          httpEnabledField.modified ||
          (redirEnabledField.value && redirPortField.modified) ||
          redirEnabledField.modified ||
          (tproxyEnabledField.value && tproxyPortField.modified) ||
          tproxyEnabledField.modified
        }
      >
        <TextField
          autoComplete="new-password"
          disabled={false}
          size="small"
          value={displayedMixedPort}
          sx={{ width: 100, input: { py: '7.5px', cursor: 'pointer' } }}
          onClick={(e) => {
            portRef.current?.open()
            ;(e.target as HTMLElement).blur()
          }}
        />
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.external')}
        extra={
          <TooltipIcon
            title={t('settings.sections.externalCors.tooltips.open')}
            icon={SettingsRounded}
            onClick={(e) => {
              e.stopPropagation()
              corsRef.current?.open()
            }}
          />
        }
        onClick={() => {
          ctrlRef.current?.open()
        }}
      />

      <SettingItem
        onClick={() => webRef.current?.open()}
        label={t('settings.sections.clash.form.fields.webUI')}
      />

      <SettingItem
        label={t('settings.sections.clash.form.fields.clashCore')}
        extra={
          <TooltipIcon
            icon={SettingsRounded}
            onClick={() => coreRef.current?.open()}
          />
        }
      >
        <Typography sx={{ py: '7px', pr: 1 }}>{version}</Typography>
      </SettingItem>

      {isWIN && (
        <SettingItem
          onClick={invoke_uwp_tool}
          label={t('settings.sections.clash.form.fields.openUwpTool')}
          extra={
            <TooltipIcon
              title={t('settings.sections.clash.form.tooltips.openUwpTool')}
              sx={{ opacity: '0.7' }}
            />
          }
        />
      )}

      <SettingItem
        onClick={onUpdateGeo}
        label={t('settings.sections.clash.form.fields.updateGeoData')}
      />

      <SettingItem
        label={t('settings.sections.clash.form.fields.tunnels.title')}
        onClick={() => tunnelRef.current?.open()}
      />
    </SettingList>
  )
}

export default SettingClash
