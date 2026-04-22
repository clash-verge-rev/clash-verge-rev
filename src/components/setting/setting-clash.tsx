import {
  LanRounded,
  NetworkCheckRounded,
  SettingsRounded,
} from '@mui/icons-material'
import { MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateGeo } from 'tauri-plugin-mihomo-api'

import { DialogRef, Switch, TooltipIcon } from '@/components/base'
import { useClash } from '@/hooks/use-clash'
import { useClashLog } from '@/hooks/use-clash-log'
import { useVerge } from '@/hooks/use-verge'
import { WIFI_DETECTION_QUERY_KEY } from '@/hooks/use-wifi-detection-status'
import { invoke_uwp_tool, requestWifiDetectionAuth } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { debugLog } from '@/utils/debug'
import getSystem from '@/utils/get-system'

import { ClashCoreViewer } from './mods/clash-core-viewer'
import { ClashPortViewer } from './mods/clash-port-viewer'
import { ControllerViewer } from './mods/controller-viewer'
import { DnsViewer } from './mods/dns-viewer'
import { HeaderConfiguration } from './mods/external-controller-cors'
import { GuardState } from './mods/guard-state'
import { NetworkContextViewer } from './mods/network-context-viewer'
import { NetworkInterfaceViewer } from './mods/network-interface-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'
import { TunnelsViewer } from './mods/tunnels-viewer'
import { WebUIViewer } from './mods/web-ui-viewer'
import { WifiDetectionStatusLine } from './mods/wifi-detection-status-line'

const isWIN = getSystem() === 'windows'
const isMAC = getSystem() === 'macos'

interface Props {
  onError: (err: Error) => void
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { clash, version, mutateClash, patchClash } = useClash()
  const { verge, patchVerge } = useVerge()
  const [, setClashLog] = useClashLog()

  const {
    ipv6,
    'allow-lan': allowLan,
    'log-level': logLevel,
    'unified-delay': unifiedDelay,
  } = clash ?? {}

  const { verge_mixed_port } = verge ?? {}

  // Wi-Fi 识别开关默认值与后端 `module::netmon::DEFAULT_WIFI_DETECTION` 一致：
  // macOS 默认关（CoreLocation 授权成本），其他平台默认开（WEXT / WlanAPI
  // 无授权开销）。
  const wifiDetectionDefault = !isMAC
  const wifiDetectionEnabled =
    verge?.enable_wifi_detection ?? wifiDetectionDefault

  // 独立跟踪DNS设置开关状态
  const [dnsSettingsEnabled, setDnsSettingsEnabled] = useState(() => {
    return verge?.enable_dns_settings ?? false
  })

  const webRef = useRef<DialogRef>(null)
  const portRef = useRef<DialogRef>(null)
  const ctrlRef = useRef<DialogRef>(null)
  const coreRef = useRef<DialogRef>(null)
  const networkRef = useRef<DialogRef>(null)
  const dnsRef = useRef<DialogRef>(null)
  const corsRef = useRef<DialogRef>(null)
  const tunnelRef = useRef<DialogRef>(null)
  const netCtxRef = useRef<DialogRef>(null)

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

  // 实现DNS设置开关处理函数
  const handleDnsToggle = useLockFn(async (enable: boolean) => {
    try {
      setDnsSettingsEnabled(enable)
      await patchVerge({ enable_dns_settings: enable })
      await invoke('apply_dns_config', { apply: enable })
      setTimeout(() => {
        mutateClash()
      }, 500)
    } catch (err: any) {
      setDnsSettingsEnabled(!enable)
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
      <NetworkContextViewer ref={netCtxRef} />
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
          checked={dnsSettingsEnabled}
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
        label={t('settings.sections.clash.form.fields.wifiDetection')}
        secondary={<WifiDetectionStatusLine />}
        extra={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <TooltipIcon
              title={t('settings.sections.clash.form.tooltips.wifiDetection')}
              sx={{ opacity: '0.7' }}
            />
            <TooltipIcon
              icon={NetworkCheckRounded}
              title={t('settings.sections.clash.form.fields.networkContext')}
              aria-label={t(
                'settings.sections.clash.form.fields.networkContext',
              )}
              sx={{ opacity: '0.7' }}
              onClick={() => netCtxRef.current?.open()}
            />
          </Stack>
        }
      >
        <GuardState
          value={wifiDetectionEnabled}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={() => {
            /* 不做 optimistic 本地更新：实际值经 patchVerge 回写 + useQuery 刷新 */
          }}
          onGuard={async (v: boolean) => {
            await patchVerge({ enable_wifi_detection: v })
            // macOS 翻 ON 时触发 CoreLocation 授权弹窗；delegate 回调会 emit
            // wifi-auth-changed 事件驱动 UI。这里再显式 invalidate 一次以覆盖
            // 未弹窗场景（状态已是 Authorized / Denied，delegate 不会回调）。
            // 授权请求失败不视作 toggle 失败（用户意图已被 patchVerge 持久化），
            // 但记录到 debug 日志便于排查"UI 停在 waiting"这类现象。
            if (v && isMAC) {
              await requestWifiDetectionAuth().catch((err) => {
                debugLog('[wifi-detection] request auth failed:', err)
              })
            }
            await queryClient.invalidateQueries({
              queryKey: WIFI_DETECTION_QUERY_KEY,
            })
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.virtualIfaceReporting')}
        extra={
          <TooltipIcon
            title={t(
              'settings.sections.clash.form.tooltips.virtualIfaceReporting',
            )}
            sx={{ opacity: '0.7' }}
          />
        }
      >
        <GuardState
          value={verge?.enable_virtual_iface_reporting ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={() => {
            /* 不做 optimistic 本地更新：实际值经 patchVerge 回写 + useVerge 刷新 */
          }}
          onGuard={(v: boolean) =>
            patchVerge({ enable_virtual_iface_reporting: v })
          }
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
            setClashLog((pre) => ({ ...pre!, logLevel: e }))
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
          value={verge_mixed_port ?? 7897}
          sx={{ width: 100, input: { py: '7.5px', cursor: 'pointer' } }}
          onClick={(e) => {
            portRef.current?.open()
            ;(e.target as any).blur()
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
