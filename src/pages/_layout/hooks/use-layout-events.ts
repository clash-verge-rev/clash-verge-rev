import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { revalidateProfiles } from '@/hooks/use-profiles'
import { runStateQueryKey } from '@/hooks/use-system-state'
import type { RunState } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { revalidateQueries, setCacheData } from '@/services/query-client'

import { forgetShownStartupError } from '../utils/notification-handlers'

export const useLayoutEvents = (
  handleNotice: (payload: [string, string]) => void,
) => {
  useEffect(() => {
    let lastProfileId: string | null = null
    let lastProfileUpdateTime = 0
    const refreshThrottle = 800

    const revalidateKeys = (keys: readonly string[]) => {
      void revalidateQueries(keys.map((key) => [key]))
    }

    const handleProfileChanged = (newProfileId: string) => {
      const now = Date.now()
      if (
        lastProfileId === newProfileId &&
        now - lastProfileUpdateTime < refreshThrottle
      ) {
        return
      }
      lastProfileId = newProfileId
      lastProfileUpdateTime = now
      void revalidateProfiles()
    }

    const unsubscribe = subscribeVergeEvents(
      {
        'profile-changed': handleProfileChanged,
        'verge://refresh-profiles': () => void revalidateProfiles(),
        'verge://refresh-clash-config': () => {
          revalidateKeys([
            'getProxyView',
            'getVersion',
            'getClashConfig',
            'getClashInfo',
            'getClashMode',
            'getRuntimeConfig',
            'getRules',
            'getRuleProviders',
          ])
        },
        'verge://refresh-verge-config': () => {
          revalidateKeys([
            'getVergeConfig',
            'getSystemProxy',
            'getAutotemProxy',
          ])
        },
        // Transitions carry the full run-state snapshot, so write it directly to cache.
        'verge://run-state-changed': (payload) => {
          void setCacheData<RunState>(runStateQueryKey, payload)
          if (payload.mode !== 'NotRunning') forgetShownStartupError()
        },
        'verge://notice-message': handleNotice,
      },
      // Re-read event-only state after subscribing to close the initial race window.
      () => {
        revalidateKeys(['getRuntimeState', 'getVergeConfig'])
        handleNotice(['dns_override::auto_disabled', ''])
        handleNotice(['enhance::discarded_keys', ''])
        handleNotice(['service_core::sidecar_fallback', ''])
        handleNotice(['service_core::repair_required', ''])
        handleNotice(['service_core::app_data_not_owned', ''])
        handleNotice(['core_start::error', ''])
      },
    )
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) handleNotice(['core_start::error', ''])
    })
    return () => {
      unsubscribe()
      void unlistenFocus.then((unlisten) => unlisten())
    }
  }, [handleNotice])
}
