import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { RunState } from './cmds'

/** Centralizes frontend event names and payload types for the unchecked Rust IPC seam. */
interface VergeEvents {
  'verge://refresh-clash-config': string
  'verge://refresh-verge-config': string
  'verge://refresh-profiles': string
  'verge://refresh-proxy-config': null
  /** A backend message for the user: `[status, message]`. */
  'verge://notice-message': [string, string]
  'verge://timer-updated': string
  'verge://run-state-changed': RunState
  'verge://pending-failures-changed': null
  'profile-changed': string
  'profile-update-started': { uid?: string }
  'profile-update-completed': { uid?: string }
  'verge://test-all': null
}

type VergeEventName = keyof VergeEvents

type VergeEventHandlers = {
  [Name in VergeEventName]?: (payload: VergeEvents[Name]) => void
}

/**
 * Returns synchronous teardown for asynchronous registrations. `onSubscribed` lets callers
 * reread event-only state after all listeners are live, closing the initial race window.
 */
export const subscribeVergeEvents = (
  handlers: VergeEventHandlers,
  onSubscribed?: () => void,
): (() => void) => {
  let disposed = false
  const unlisteners: UnlistenFn[] = []

  const registrations = Object.entries(handlers).map(([name, handler]) => {
    if (!handler) return Promise.resolve()

    return listen(name, ({ payload }) => {
      ;(handler as (payload: unknown) => void)(payload)
    })
      .then((unlisten) => {
        // Resolved after teardown: unsubscribe immediately rather than leak.
        if (disposed) {
          unlisten()
          return
        }
        unlisteners.push(unlisten)
      })
      .catch((error) => {
        console.error(`[events] failed to subscribe to ${name}:`, error)
      })
  })

  if (onSubscribed) {
    void Promise.all(registrations).then(() => {
      if (disposed) return
      onSubscribed()
    })
  }

  return () => {
    disposed = true
    for (const unlisten of unlisteners.splice(0)) {
      try {
        unlisten()
      } catch (error) {
        console.error('[events] teardown failed:', error)
      }
    }
  }
}
