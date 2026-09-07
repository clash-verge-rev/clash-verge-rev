import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogRef, Switch, TooltipIcon } from '@/components/base'
import ProxyControlSwitches from '@/components/shared/proxy-control-switches'
import { useVergeConfigField } from '@/hooks/use-verge'

import { GuardState } from './mods/guard-state'
import { SettingList, SettingItem } from './mods/setting-comp'
import { SysproxyViewer } from './mods/sysproxy-viewer'
import { TunViewer } from './mods/tun-viewer'

interface Props {
  onError?: (err: Error) => void
}

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation()

  const autoLaunchField = useVergeConfigField('enable_auto_launch', false)
  const silentStartField = useVergeConfigField('enable_silent_start', false)

  const sysproxyRef = useRef<DialogRef>(null)
  const tunRef = useRef<DialogRef>(null)

  const onSwitchFormat = (
    _e: React.ChangeEvent<HTMLInputElement>,
    value: boolean,
  ) => value

  return (
    <SettingList title={t('settings.sections.system.title')}>
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />

      <ProxyControlSwitches
        label={t('settings.sections.system.toggles.tunMode')}
        onError={onError}
      />

      <ProxyControlSwitches
        label={t('settings.sections.system.toggles.systemProxy')}
        onError={onError}
      />

      <SettingItem
        label={t('settings.sections.system.fields.autoLaunch')}
        modified={autoLaunchField.modified}
      >
        <GuardState
          value={autoLaunchField.value}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={autoLaunchField.mutate}
          onGuard={autoLaunchField.patch}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.system.fields.silentStart')}
        extra={
          <TooltipIcon
            title={t('settings.sections.system.tooltips.silentStart')}
            sx={{ opacity: '0.7' }}
          />
        }
        modified={silentStartField.modified}
      >
        <GuardState
          value={silentStartField.value}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={silentStartField.mutate}
          onGuard={silentStartField.patch}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>
    </SettingList>
  )
}

export default SettingSystem
