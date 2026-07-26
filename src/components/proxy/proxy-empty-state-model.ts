import type { ProxyViewV1 } from '@/types/proxy-view'

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

interface ProxyEmptyStateInput {
  mode: string
  isChainMode: boolean
  profiles?: ProfileSummary
  isProfilesPending: boolean
  proxyView?: ProxyViewV1
  isProxyViewPending: boolean
  isProxyViewError: boolean
  runningMode?: string
  isRunningModePending: boolean
}

const isSubscriptionProfile = (item: { type?: string }): boolean =>
  item.type === 'remote' || item.type === 'local'

const hasRenderableProxyContent = (
  proxyView: ProxyViewV1 | undefined,
  mode: string,
  isChainMode: boolean,
) => {
  if (!proxyView) return false

  if (isChainMode) {
    return proxyView.groups.some(
      (group) => group.type === 'Selector' || group.type === 'URLTest',
    )
  }

  if (mode === 'rule' || mode === 'script') {
    return proxyView.groups.some((group) => !group.hidden)
  }

  return proxyView.global !== null
}

/**
 * What the proxy page should show.
 *
 * One closed set rather than `reason | 'loading' | null`: the old shape smuggled 'loading'
 * into the reason union, which lied about what `ProxyEmptyState` accepts, and left the caller
 * to decide the direct-mode case a second time.
 */
export type ProxyListState =
  | { kind: 'direct' }
  | { kind: 'loading' }
  | { kind: 'empty'; reason: ProxyEmptyStateReason }
  | { kind: 'content' }

export const resolveProxyListState = ({
  mode,
  isChainMode,
  profiles,
  isProfilesPending,
  proxyView,
  isProxyViewPending,
  isProxyViewError,
  runningMode,
  isRunningModePending,
}: ProxyEmptyStateInput): ProxyListState => {
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

  if (hasRenderableProxyContent(proxyView, mode, isChainMode)) {
    return { kind: 'content' }
  }

  if (runningMode === 'NotRunning' || isProxyViewError) {
    return { kind: 'empty', reason: 'core-unavailable' }
  }

  return { kind: 'empty', reason: 'no-proxy-info' }
}
