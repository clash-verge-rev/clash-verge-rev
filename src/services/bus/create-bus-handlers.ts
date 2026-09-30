import type { VergeEventPayloads } from '@/services/contract'
import { forgetShownStartupError } from '@/services/notice-handlers'
import type { AppStoreAction } from '@/store/app-state'

/** Frontend-internal event: home test card → test items. Not in the backend contract. */
export const TEST_ALL_EVENT = 'verge://test-all'

type BusEventName = keyof VergeEventPayloads | typeof TEST_ALL_EVENT

type BusHandlers = {
  [Name in BusEventName]: (
    payload: Name extends keyof VergeEventPayloads
      ? VergeEventPayloads[Name]
      : null,
  ) => void
}

export interface BusHandlerDeps {
  dispatch: (action: AppStoreAction) => void
  /** Notice-table entry point; layout owns t/navigate wiring. */
  handleNotice: (payload: [string, string]) => void
  revalidateKeys: (keys: readonly string[]) => void
  revalidateProfiles: () => void
  refreshProxyView: () => void
  /** Re-read the backend pending-failure snapshot into the store. */
  readPendingFailures: () => void
}

export interface EventBus {
  handlers: BusHandlers
  /** Re-read event-only state after listeners are live (initial race window). */
  onSubscribed: () => void
  /** The window regained focus: replay a possibly recovered startup error. */
  onWindowFocus: () => void
}

/**
 * Pure per-event handler table for the bus. Handlers may trigger documented
 * side effects (SWR revalidation, notice toasts) but write store state only
 * through dispatched pure actions. Created exactly once per bus mount; the
 * throttles below live in the returned closure, mirroring the previous
 * scattered listeners.
 */
export const createEventBus = (deps: BusHandlerDeps): EventBus => {
  let lastProfileId: string | null = null
  let lastProfileChangeTime = 0
  let lastProxyRefreshTime = 0
  const refreshThrottle = 800

  const handleProfileChanged = (newProfileId: string) => {
    const now = Date.now()
    if (
      lastProfileId === newProfileId &&
      now - lastProfileChangeTime < refreshThrottle
    ) {
      return
    }
    lastProfileId = newProfileId
    lastProfileChangeTime = now
    deps.revalidateProfiles()
  }

  const handleRefreshProxyConfig = () => {
    const now = Date.now()
    if (now - lastProxyRefreshTime <= refreshThrottle) return
    lastProxyRefreshTime = now
    deps.refreshProxyView()
  }

  const handlers: BusHandlers = {
    'verge://refresh-clash-config': () =>
      deps.revalidateKeys([
        'getProxyView',
        'getVersion',
        'getClashConfig',
        'getClashInfo',
        'getClashMode',
        'getRuntimeConfig',
        'getRules',
        'getRuleProviders',
      ]),
    'verge://refresh-verge-config': () =>
      deps.revalidateKeys([
        'getVergeConfig',
        'getSystemProxy',
        'getAutotemProxy',
      ]),
    'verge://refresh-profiles': () => deps.revalidateProfiles(),
    'verge://refresh-proxy-config': handleRefreshProxyConfig,
    'verge://notice-message': (payload) => deps.handleNotice(payload),
    'profile-changed': handleProfileChanged,
    'verge://timer-updated': (uid) =>
      deps.dispatch({ type: 'profileUpdate/timerTick', uid }),
    'profile-update-started': ({ uid }) =>
      deps.dispatch({ type: 'profileUpdate/started', uid }),
    'profile-update-completed': ({ uid }) => {
      deps.dispatch({ type: 'profileUpdate/completed', uid })
      deps.revalidateProfiles()
    },
    'verge://run-state-changed': (payload) => {
      deps.dispatch({ type: 'runState/loaded', runState: payload })
      // A running core resolves every failure shown before it.
      if (payload.mode !== 'NotRunning') forgetShownStartupError()
    },
    'verge://pending-failures-changed': () => deps.readPendingFailures(),
    [TEST_ALL_EVENT]: () => deps.dispatch({ type: 'testAll/requested' }),
  } as BusHandlers

  const onSubscribed = () => {
    deps.revalidateKeys(['getVergeConfig'])
    deps.readPendingFailures()
    deps.handleNotice(['dns_override::auto_disabled', ''])
    deps.handleNotice(['enhance::discarded_keys', ''])
    deps.handleNotice(['service_core::sidecar_fallback', ''])
    deps.handleNotice(['service_core::repair_required', ''])
    deps.handleNotice(['service_core::app_data_not_owned', ''])
    deps.handleNotice(['core_start::error', ''])
  }

  const onWindowFocus = () => {
    deps.handleNotice(['core_start::error', ''])
  }

  return { handlers, onSubscribed, onWindowFocus }
}
