import { useEffect } from 'react'

import { runStateQueryKey } from '@/hooks/use-system-state'
import type { RunState } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { revalidateQueries, setCacheDataAsync } from '@/services/query-client'

export const useLayoutEvents = (
  handleNotice: (payload: [string, string]) => void,
) => {
  useEffect(() => {
    const revalidateKeys = (keys: readonly string[]) => {
      void revalidateQueries(keys.map((key) => [key]))
    }

    return subscribeVergeEvents({
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
        revalidateKeys(['getVergeConfig', 'getSystemProxy', 'getAutotemProxy'])
      },
      // The Run State is pushed, not polled: every transition carries the new snapshot, so it
      // is written straight into the cache instead of triggering a fetch.
      'verge://run-state-changed': (payload) => {
        void setCacheDataAsync<RunState>(runStateQueryKey, payload)
      },
      'verge://notice-message': handleNotice,
    })
  }, [handleNotice])
}
