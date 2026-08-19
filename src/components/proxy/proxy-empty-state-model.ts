export type ProxyEmptyStateReason =
  | 'no-subscriptions'
  | 'inactive-subscription'
  | 'core-unavailable'
  | 'no-proxy-info'

type ProfileSummary = {
  current?: string
  items?: Array<{
    uid?: string
    type?: string
  }>
}

interface ProxyListStateInput {
  mode: string
  profiles?: ProfileSummary
  isProfilesPending: boolean
  isProxyViewPending: boolean
  isRunningModePending: boolean
}

const isSubscriptionProfile = (item: { type?: string }): boolean =>
  item.type === 'remote' || item.type === 'local'

/** Decides only pre-render states; the built list owns whether it has renderable content. */
export type ProxyListState =
  | { kind: 'direct' }
  | { kind: 'loading' }
  | { kind: 'empty'; reason: ProxyEmptyStateReason }
  | { kind: 'render' }

export const resolveProxyListState = ({
  mode,
  profiles,
  isProfilesPending,
  isProxyViewPending,
  isRunningModePending,
}: ProxyListStateInput): ProxyListState => {
  if (mode === 'direct') return { kind: 'direct' }

  if (isProfilesPending || isProxyViewPending || isRunningModePending) {
    return { kind: 'loading' }
  }

  if (profiles) {
    const subscriptions = (profiles.items ?? []).filter(isSubscriptionProfile)
    if (subscriptions.length === 0) {
      return { kind: 'empty', reason: 'no-subscriptions' }
    }

    const hasActiveSubscription = subscriptions.some(
      (item) => item.uid === profiles.current,
    )
    if (!hasActiveSubscription) {
      return { kind: 'empty', reason: 'inactive-subscription' }
    }
  }

  return { kind: 'render' }
}

/** Explains an empty list only after the renderer observes it. */
export const resolveEmptyListReason = ({
  runningMode,
  isProxyViewError,
}: {
  runningMode?: string
  isProxyViewError: boolean
}): ProxyEmptyStateReason =>
  runningMode === 'NotRunning' || isProxyViewError
    ? 'core-unavailable'
    : 'no-proxy-info'
