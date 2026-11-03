import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch, type DialogRef } from '@/components/base'
import {
  DEFAULT_HOTSPOT_SSID,
  useHotspotActions,
  useHotspotStatus,
} from '@/hooks/use-hotspot'
import { useVerge } from '@/hooks/use-verge'
import type { HotspotState } from '@/services/cmds'
import type { TranslationKey } from '@/types/generated/i18n-keys'

import { GuardState } from './mods/guard-state'
import HotspotViewer from './mods/hotspot-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'

interface Props {
  onError?: (err: Error) => void
}

const SettingHotspot = ({ onError }: Props) => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { status } = useHotspotStatus()
  const { start, stop } = useHotspotActions()
  const viewerRef = useRef<DialogRef>(null)

  const ssid = verge?.hotspot_ssid || DEFAULT_HOTSPOT_SSID
  const band = verge?.hotspot_band || 'auto'
  const bandKey: TranslationKey =
    band === '2.4'
      ? 'settings.modals.hotspot.bands.band24'
      : band === '5'
        ? 'settings.modals.hotspot.bands.band5'
        : 'settings.modals.hotspot.bands.auto'
  const state: HotspotState = status?.state ?? 'stopped'
  const running = state === 'running' || state === 'starting'

  const statusKey: TranslationKey =
    state === 'running'
      ? 'settings.sections.hotspot.status.running'
      : state === 'starting'
        ? 'settings.sections.hotspot.status.starting'
        : state === 'stopping'
          ? 'settings.sections.hotspot.status.stopping'
          : state === 'unsupported'
            ? 'settings.sections.hotspot.status.unsupported'
            : state === 'failed'
              ? 'settings.sections.hotspot.status.failed'
              : 'settings.sections.hotspot.status.stopped'

  const detail =
    state === 'failed' && status?.message
      ? status.message
      : state === 'running'
        ? [t(statusKey, { count: status?.clients ?? 0 }), status?.gateway]
            .filter(Boolean)
            .join(' · ')
        : t(statusKey)

  const onToggle = async (value: boolean) => {
    if (!value) {
      await stop()
      return
    }

    const password = verge?.hotspot_password ?? ''
    if (password.length < 8) {
      viewerRef.current?.open()
      throw new Error(
        t('settings.sections.hotspot.messages.credentialsRequired'),
      )
    }

    await start({
      ssid,
      password,
      band,
      adapterId: verge?.hotspot_adapter_id || null,
    })
  }

  return (
    <SettingList title={t('settings.sections.hotspot.title')}>
      <SettingItem
        label={t('settings.sections.hotspot.toggles.enable')}
        secondary={detail}
      >
        <GuardState
          value={running}
          valueProps="checked"
          onCatch={onError}
          onFormat={(_event, value: boolean) => value}
          onGuard={onToggle}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.hotspot.fields.configuration')}
        secondary={t('settings.sections.hotspot.secondary.configuration', {
          ssid,
          band: t(bandKey),
        })}
        onClick={() => viewerRef.current?.open()}
      />

      <SettingItem
        label={t('settings.sections.hotspot.fields.autoStart')}
        secondary={t('settings.sections.hotspot.tooltips.autoStart')}
      >
        <GuardState
          value={verge?.hotspot_auto_start ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={(_event, value: boolean) => value}
          onChange={(value) => {
            mutateVerge({ ...verge, hotspot_auto_start: value })
          }}
          onGuard={async (value) => {
            try {
              await patchVerge({ hotspot_auto_start: value })
            } catch (error) {
              mutateVerge({ ...verge, hotspot_auto_start: !value })
              throw error
            }
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <HotspotViewer ref={viewerRef} onError={onError} />
    </SettingList>
  )
}

export default SettingHotspot
