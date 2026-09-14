import { LanRounded, SettingsRounded } from '@mui/icons-material'
import { MenuItem, Select, TextField, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateGeo, type LogLevel } from 'tauri-plugin-mihomo-api'

import { BaseDialog, DialogRef, Switch, TooltipIcon } from '@/components/base'
import { useClash } from '@/hooks/use-clash'
import { useClashLog } from '@/hooks/use-clash-log'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useVerge } from '@/hooks/use-verge'
import { invoke_uwp_tool, setDnsOverride } from '@/services/cmds'
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

  const { clash, version, mutateClash, patchClash } = useClash()
  const { verge, mutateVerge } = useVerge()
  const displayedMixedPort = useDisplayedMixedPort()
  const [, setClashLog] = useClashLog()

  const {
    ipv6,
    'allow-lan': allowLan,
    'log-level': logLevel,
    'unified-delay': unifiedDelay,
  } = clash ?? {}

  const [dnsConfirmation, setDnsConfirmation] = useState<string | null>(null)
  const [dnsUpdating, setDnsUpdating] = useState(false)

  const webRef = useRef<DialogRef>(null)
  const portRef = useRef<DialogRef>(null)
  const ctrlRef = useRef<DialogRef>(null)
  const coreRef = useRef<DialogRef>(null)
  const networkRef = useRef<DialogRef>(null)
  const dnsRef = useRef<DialogRef>(null)
  const corsRef = useRef<DialogRef>(null)
  const tunnelRef = useRef<DialogRef>(null)

  const onSwitchFormat = (_e: any, value: boolean) => value
  const onChangeData = (patch: Partial<IConfigData>) => {
    mutateClash((old) => ({ ...old!, ...patch }), false)
  }
  const onUpdateGeo = async () => {
    try {
      await updateGeo()
      showNotice.success('settings.feedback.notifications.clash.geoDataUpdated')
    } catch (err: any) {
      showNotice.error(err)
    }
  }

  const handleDnsToggle = useLockFn(
    async (enable: boolean, confirmation?: string) => {
      setDnsUpdating(true)
      try {
        const outcome = await setDnsOverride(enable, confirmation)
        if (outcome.status === 'confirmation_required') {
          setDnsConfirmation(outcome.source)
        } else {
          setDnsConfirmation(null)
        }
        mutateVerge()
        mutateClash()
      } catch (err: any) {
        showNotice.error(err)
      } finally {
        setDnsUpdating(false)
      }
    },
  )

  const closeDnsConfirmation = () => {
    if (!dnsUpdating) setDnsConfirmation(null)
  }

  return (
    <SettingList title={t('settings.sections.clash.title')}>
      <WebUIViewer ref={webRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />
      <ClashCoreViewer ref={coreRef} />
      <NetworkInterfaceViewer ref={networkRef} />
      <DnsViewer ref={dnsRef} />
      <BaseDialog
        open={dnsConfirmation !== null}
        title={t('settings.modals.dns.protection.title')}
        okBtn={t('settings.modals.dns.protection.enableAnyway')}
        cancelBtn={t('settings.modals.dns.protection.keepDisabled')}
        contentSx={{ width: { xs: 320, sm: 420 } }}
        loading={dnsUpdating}
        disableCancel={dnsUpdating}
        onCancel={closeDnsConfirmation}
        onClose={closeDnsConfirmation}
        onOk={() => {
          if (dnsConfirmation) void handleDnsToggle(true, dnsConfirmation)
        }}
      >
        <Typography variant="body2">
          {t('settings.modals.dns.protection.message')}
        </Typography>
      </BaseDialog>
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
      >
        <GuardState
          value={allowLan ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ 'allow-lan': e })}
          onGuard={(e) => patchClash({ 'allow-lan': e })}
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
      >
        <Switch
          edge="end"
          checked={verge?.enable_dns_settings ?? false}
          disabled={dnsUpdating || dnsConfirmation !== null}
          onChange={(_, checked) => handleDnsToggle(checked)}
        />
      </SettingItem>

      <SettingItem label={t('settings.sections.clash.form.fields.ipv6')}>
        <GuardState
          value={ipv6 ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ ipv6: e })}
          onGuard={(e) => patchClash({ ipv6: e })}
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
      >
        <GuardState
          value={unifiedDelay ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ 'unified-delay': e })}
          onGuard={(e) => patchClash({ 'unified-delay': e })}
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
      >
        <GuardState
          value={logLevel === 'warn' ? 'warning' : (logLevel ?? 'info')}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ 'log-level': e })}
          onGuard={(e) => {
            setClashLog((pre) => ({
              ...pre!,
              logLevel: e.toUpperCase() as LogLevel,
            }))
            return patchClash({ 'log-level': e })
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

      <SettingItem label={t('settings.sections.clash.form.fields.portConfig')}>
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
