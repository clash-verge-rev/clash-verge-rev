import { useEffect } from 'react'

import { revalidateProfiles } from '@/hooks/use-profiles'
import { runStateQueryKey } from '@/hooks/use-system-state'
import type { RunState } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { revalidateQueries, setCacheData } from '@/services/query-client'

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

    return subscribeVergeEvents(
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
        },
        'verge://notice-message': handleNotice,
      },
      // Re-read event-only state after subscribing to close the initial race window.
      () => revalidateKeys(['getRuntimeState']),
    )
  }, [handleNotice])
}
