import { useEffect } from 'react'

import { useListen } from '@/hooks/use-listen'
import { runStateQueryKey } from '@/hooks/use-system-state'
import type { RunState } from '@/services/cmds'
import { revalidateQueries, setCacheDataAsync } from '@/services/query-client'

export const useLayoutEvents = (
  handleNotice: (payload: [string, string]) => void,
) => {
  const { addListener } = useListen()

  useEffect(() => {
    const unlisteners: Array<() => void> = []
    let disposed = false
    const revalidateKeys = (keys: readonly string[]) => {
      void revalidateQueries(keys.map((key) => [key]))
    }

    const register = (
      maybeUnlisten: void | (() => void) | Promise<void | (() => void)>,
    ) => {
      if (!maybeUnlisten) return

      if (typeof maybeUnlisten === 'function') {
        unlisteners.push(maybeUnlisten)
        return
      }

      maybeUnlisten
        .then((unlisten) => {
          if (!unlisten) return
          if (disposed) {
            unlisten()
          } else {
            unlisteners.push(unlisten)
          }
        })
        .catch((error) =>
          console.error('[Event Listener] Registration failed:', error),
        )
    }

    register(
      addListener('verge://refresh-clash-config', () => {
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
      }),
    )

    register(
      addListener('verge://refresh-verge-config', () => {
        revalidateKeys(['getVergeConfig', 'getSystemProxy', 'getAutotemProxy'])
      }),
    )

    // The Run State is pushed, not polled: every transition carries the new snapshot, so it
    // is written straight into the cache instead of triggering a fetch.
    register(
      addListener<RunState>('verge://run-state-changed', ({ payload }) => {
        void setCacheDataAsync<RunState>(runStateQueryKey, payload)
      }),
    )

    register(
      addListener('verge://notice-message', ({ payload }) =>
        handleNotice(payload as [string, string]),
      ),
    )

    return () => {
      disposed = true
      const errors: Error[] = []

      unlisteners.forEach((unlisten) => {
        try {
          unlisten()
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)))
        }
      })

      if (errors.length > 0) {
        console.error(
          `[Event Listener] Encountered ${errors.length} errors during cleanup:`,
          errors,
        )
      }

      unlisteners.length = 0
    }
  }, [addListener, handleNotice])
}
