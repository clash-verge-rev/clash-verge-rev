import { describe, expect, test } from 'vitest'

import type { ProxyViewV1 } from '@/types/proxy-view'

import { resolveProxyListState } from './proxy-empty-state-model'

const view = (overrides: Partial<ProxyViewV1> = {}) =>
  ({
    schemaVersion: 1,
    orderSource: 'runtime',
    providerState: 'ready',
    global: null,
    direct: null,
    groups: [],
    records: {},
    standalone: [],
    providers: [],
    ...overrides,
  }) as unknown as ProxyViewV1

const group = (overrides: Record<string, unknown> = {}) =>
  ({
    name: 'Proxies',
    type: 'Selector',
    alive: true,
    history: [],
    udp: true,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
    hidden: false,
    members: [],
    ...overrides,
  }) as unknown as ProxyViewV1['groups'][number]

const settled = {
  isProfilesPending: false,
  isProxyViewPending: false,
  isProxyViewError: false,
  isRunningModePending: false,
  runningMode: 'Sidecar',
}

const subscribed = {
  current: 'a',
  items: [{ uid: 'a', type: 'remote' }],
}

describe('resolveProxyListState', () => {
  test('direct mode is its own outcome, not an empty list', () => {
    // The caller used to decide this a second time, after asking the model.
    const state = resolveProxyListState({
      ...settled,
      mode: 'direct',
      isChainMode: false,
      profiles: { current: undefined, items: [] },
    })

    expect(state).toEqual({ kind: 'direct' })
  })

  test('anything still loading outranks every verdict about emptiness', () => {
    for (const pending of [
      { isProfilesPending: true },
      { isProxyViewPending: true },
      { isRunningModePending: true },
    ]) {
      const state = resolveProxyListState({
        ...settled,
        ...pending,
        mode: 'rule',
        isChainMode: false,
        profiles: { current: undefined, items: [] },
      })

      expect(state).toEqual({ kind: 'loading' })
    }
  })

  test('no subscription at all is reported before anything about proxies', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'rule',
      isChainMode: false,
      profiles: { current: undefined, items: [{ uid: 'a', type: 'merge' }] },
    })

    expect(state).toEqual({ kind: 'empty', reason: 'no-subscriptions' })
  })

  test('a subscription that is not the active one is its own explanation', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'rule',
      isChainMode: false,
      profiles: { current: 'other', items: [{ uid: 'a', type: 'remote' }] },
    })

    expect(state).toEqual({ kind: 'empty', reason: 'inactive-subscription' })
  })

  test('a visible group means there is something to render', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'rule',
      isChainMode: false,
      profiles: subscribed,
      proxyView: view({ groups: [group()] }),
    })

    expect(state).toEqual({ kind: 'content' })
  })

  test('hidden groups do not count as something to render', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'rule',
      isChainMode: false,
      profiles: subscribed,
      proxyView: view({ groups: [group({ hidden: true })] }),
    })

    expect(state).toEqual({ kind: 'empty', reason: 'no-proxy-info' })
  })

  test('a stopped core explains an empty list better than the list does', () => {
    const state = resolveProxyListState({
      ...settled,
      runningMode: 'NotRunning',
      mode: 'rule',
      isChainMode: false,
      profiles: subscribed,
      proxyView: view(),
    })

    expect(state).toEqual({ kind: 'empty', reason: 'core-unavailable' })
  })

  test('a failed proxy fetch is reported as the core being unavailable', () => {
    const state = resolveProxyListState({
      ...settled,
      isProxyViewError: true,
      mode: 'rule',
      isChainMode: false,
      profiles: subscribed,
      proxyView: view(),
    })

    expect(state).toEqual({ kind: 'empty', reason: 'core-unavailable' })
  })

  test('global mode asks about GLOBAL rather than about groups', () => {
    const withGroupsOnly = resolveProxyListState({
      ...settled,
      mode: 'global',
      isChainMode: false,
      profiles: subscribed,
      proxyView: view({ groups: [group()] }),
    })
    expect(withGroupsOnly).toEqual({ kind: 'empty', reason: 'no-proxy-info' })

    const withGlobal = resolveProxyListState({
      ...settled,
      mode: 'global',
      isChainMode: false,
      profiles: subscribed,
      proxyView: view({ global: group({ name: 'GLOBAL' }) }),
    })
    expect(withGlobal).toEqual({ kind: 'content' })
  })
})
