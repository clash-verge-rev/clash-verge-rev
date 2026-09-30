import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { getPendingFailures } from '@/services/cmds'
import { revalidateQueries } from '@/services/query-client'
import { useAppDispatch } from '@/store/app-store-context'

import { createEventBus } from './create-bus-handlers'

/**
 * Mounts the event bus exactly once (layout root): one `listen` per contract
 * event plus the frontend-internal test-all event. Replaces every scattered
 * subscription; teardown disposes late-resolving registrations.
 */
export const useEventBus = (
  handleNotice: (payload: [string, string]) => void,
) => {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const revalidateKeys = (keys: readonly string[]) => {
      void revalidateQueries(keys.map((key) => [key]))
    }
    const readPendingFailures = () => {
      getPendingFailures()
        .then((failures) =>
          dispatch({ type: 'pendingFailures/loaded', failures }),
        )
        .catch((error) => {
          console.warn('[bus] pending failures could not be read:', error)
        })
    }

    const bus = createEventBus({
      dispatch,
      handleNotice,
      revalidateKeys,
      revalidateProfiles: () => {
        void revalidateQueries([['getProfiles']])
      },
      refreshProxyView: () => revalidateKeys(['getProxyView']),
      readPendingFailures,
    })

    let disposed = false
    const unlisteners: UnlistenFn[] = []
    const registrations = (
      Object.keys(bus.handlers) as Array<keyof typeof bus.handlers>
    ).map((name) =>
      listen(name, ({ payload }) => {
        ;(bus.handlers[name] as (payload: unknown) => void)(payload)
      }).then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        unlisteners.push(unlisten)
      }),
    )

    // Re-read event-only state after subscribing to close the initial race window.
    void Promise.all(registrations).then(() => {
      if (disposed) return
      bus.onSubscribed()
    })

    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) bus.onWindowFocus()
    })

    return () => {
      disposed = true
      for (const unlisten of unlisteners.splice(0)) unlisten()
      void unlistenFocus.then((unlisten) => unlisten())
    }
  }, [dispatch, handleNotice])
}
