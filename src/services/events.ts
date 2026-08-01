import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { RunState } from './cmds'

/**
 * Every event pushed to the frontend, and what it carries.
 *
 * The names were string literals on both sides of the IPC seam, so renaming one was a silent
 * no-op rather than a compile error. Declaring them here does not make the Rust side check
 * itself, but it does mean the frontend has exactly one place to look and one payload type
 * per name instead of a `listen<T>` guess at each call site.
 */
interface VergeEvents {
  /** The core's own configuration changed. */
  'verge://refresh-clash-config': string
  /** The app's configuration changed. */
  'verge://refresh-verge-config': string
  /** The set of profiles changed. */
  'verge://refresh-profiles': string
  /** The active profile's proxies changed. */
  'verge://refresh-proxy-config': null
  /** A backend message for the user: `[status, message]`. */
  'verge://notice-message': [string, string]
  /** A profile's auto-update timer was rescheduled. */
  'verge://timer-updated': string
  /** How the core is running changed; carries the whole snapshot. */
  'verge://run-state-changed': RunState
  /** Which profile is active changed. */
  'profile-changed': string
  'profile-update-started': { uid?: string }
  'profile-update-completed': { uid?: string }
  /** Frontend to frontend: the home card asks the test page to run every test. */
  'verge://test-all': null
}

type VergeEventName = keyof VergeEvents

type VergeEventHandlers = {
  [Name in VergeEventName]?: (payload: VergeEvents[Name]) => void
}

/**
 * Subscribe to backend events, returning the teardown.
 *
 * Registration is asynchronous, so a subscription can resolve after the caller has already
 * torn down; that is tracked here rather than at each call site, where it was implemented
 * four different ways and omitted in one of them.
 */
export const subscribeVergeEvents = (
  handlers: VergeEventHandlers,
): (() => void) => {
  let disposed = false
  const unlisteners: UnlistenFn[] = []

  for (const [name, handler] of Object.entries(handlers)) {
    if (!handler) continue

    listen(name, ({ payload }) => {
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
