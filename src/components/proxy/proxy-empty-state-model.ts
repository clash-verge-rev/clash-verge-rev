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

export const hasRenderableProxyContent = (
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

export const resolveProxyEmptyState = ({
  mode,
  isChainMode,
  profiles,
  isProfilesPending,
  proxyView,
  isProxyViewPending,
  isProxyViewError,
  runningMode,
  isRunningModePending,
}: ProxyEmptyStateInput): ProxyEmptyStateReason | 'loading' | null => {
  if (mode === 'direct') return null

  if (isProfilesPending || isProxyViewPending || isRunningModePending) {
    return 'loading'
  }

  if (profiles) {
    const subscriptions = (profiles.items ?? []).filter(isSubscriptionProfile)
    if (subscriptions.length === 0) return 'no-subscriptions'

    const hasActiveSubscription = subscriptions.some(
      (item) => item.uid === profiles.current,
    )
    if (!hasActiveSubscription) return 'inactive-subscription'
  }

  if (hasRenderableProxyContent(proxyView, mode, isChainMode)) {
    return null
  }

  if (runningMode === 'NotRunning' || isProxyViewError) {
    return 'core-unavailable'
  }

  return 'no-proxy-info'
}
