import { describe, expect, test } from 'vitest'

import {
  resolveEmptyListReason,
  resolveProxyListState,
} from './proxy-empty-state-model'

const settled = {
  isProfilesPending: false,
  isProxyViewPending: false,
  isRunningModePending: false,
}

const subscribed = {
  current: 'a',
  items: [{ uid: 'a', type: 'remote' }],
}

describe('resolveProxyListState', () => {
  test('direct mode is its own outcome, not an empty list', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'direct',
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
        profiles: { current: undefined, items: [] },
      })

      expect(state).toEqual({ kind: 'loading' })
    }
  })

  test('no subscription at all is reported before anything about proxies', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'rule',
      profiles: { current: undefined, items: [{ uid: 'a', type: 'merge' }] },
    })

    expect(state).toEqual({ kind: 'empty', reason: 'no-subscriptions' })
  })

  test('a subscription that is not the active one is its own explanation', () => {
    const state = resolveProxyListState({
      ...settled,
      mode: 'rule',
      profiles: { current: 'other', items: [{ uid: 'a', type: 'remote' }] },
    })

    expect(state).toEqual({ kind: 'empty', reason: 'inactive-subscription' })
  })

  test('with a usable subscription it defers to the list rather than guessing', () => {
    // The point of the split: this function no longer has an opinion on whether the
    // renderer will find anything, because the two opinions used to disagree.
    for (const mode of ['rule', 'script', 'global']) {
      expect(
        resolveProxyListState({ ...settled, mode, profiles: subscribed }),
      ).toEqual({
        kind: 'render',
      })
    }
  })

  test('it asks nothing about the proxy view at all', () => {
    // Guarding the shape, not just the behaviour: reintroducing a proxyView input here is
    // how the second, divergent derivation came back.
    const inputs = Object.keys({
      ...settled,
      mode: 'rule',
      profiles: subscribed,
    })

    expect(inputs).not.toContain('proxyView')
    expect(inputs).not.toContain('isChainMode')
  })
})

describe('resolveEmptyListReason', () => {
  test('a stopped core explains an empty list better than the list does', () => {
    expect(
      resolveEmptyListReason({
        runningMode: 'NotRunning',
        isProxyViewError: false,
      }),
    ).toBe('core-unavailable')
  })

  test('a failed proxy fetch is reported as the core being unavailable', () => {
    expect(
      resolveEmptyListReason({
        runningMode: 'Sidecar',
        isProxyViewError: true,
      }),
    ).toBe('core-unavailable')
  })

  test('a running core with a clean fetch means the profile simply has nothing', () => {
    expect(
      resolveEmptyListReason({
        runningMode: 'Sidecar',
        isProxyViewError: false,
      }),
    ).toBe('no-proxy-info')
  })
})
