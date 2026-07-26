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

/**
 * What the proxy page should show.
 *
 * Deliberately does *not* answer "is there anything to render". That question is answered by
 * the list itself, in `hasRenderableItems`, because predicting it from beside the renderer is
 * how the two came to disagree. This decides only the things knowable without building a list:
 * direct mode, still-loading, and having no usable subscription to render from.
 */
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

/**
 * Why a list that turned out to be empty is empty.
 *
 * Only reachable once the renderer has built its list and found nothing, so it explains an
 * observed emptiness rather than predicting one.
 */
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
