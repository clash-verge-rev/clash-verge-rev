import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The delay API is the only thing stubbed. What is under test is when the manager announces
 * that a group has settled — the granularity that decides whether a sorted list re-orders
 * once per test or once per result.
 */
vi.mock('tauri-plugin-mihomo-api', () => ({
  delayProxyByName: vi.fn(async () => ({ delay: 120 })),
  healthcheckNodeInProvider: vi.fn(async () => ({ delay: 120 })),
}))

import type { ResolvedProxyMember } from '@/types/proxy-view'

import delayManager from './delay'

const node = (name: string) =>
  ({
    kind: 'node',
    ref: { kind: 'node', name, recordId: `r:${name}` },
    node: {
      recordId: `r:${name}`,
      name,
      history: [],
      source: { kind: 'core', proxyName: name },
    },
  }) as unknown as ResolvedProxyMember

/** The manager coalesces notifications onto a frame; give it one. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0))

let settles = 0
let unsubscribe: () => void

beforeEach(() => {
  settles = 0
  unsubscribe = delayManager.addGroupListener('g', () => {
    settles += 1
  })
})

afterEach(() => {
  unsubscribe()
})

describe('group settle notifications', () => {
  test('a single test settles the group once', async () => {
    // The bug this fixes: a single-proxy retest updated that proxy's own display but never
    // told the list to re-sort, so a group sorted by delay kept a stale order.
    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await nextFrame()

    expect(settles).toBe(1)
  })

  test('a batch settles the group once, however many proxies it covered', async () => {
    // The granularity that matters. Announcing per result would re-sort continuously for
    // the length of the test, moving rows out from under the pointer — and the symptom
    // would be jumpy scrolling, which nothing else here could assert.
    const proxies = Array.from({ length: 20 }, (_, index) => node(`n${index}`))

    await delayManager.checkListDelay(proxies as never, 'g', 5000, 4)
    await nextFrame()

    expect(settles).toBe(1)
  })

  test('an unsubscribed listener stops being called', async () => {
    unsubscribe()

    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await nextFrame()

    expect(settles).toBe(0)
  })

  test('two listeners on one group both hear it', async () => {
    // Group listeners used to be one-per-group, so a second view silently replaced the
    // first one's subscription.
    let second = 0
    const stop = delayManager.addGroupListener('g', () => {
      second += 1
    })

    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await nextFrame()

    expect(settles).toBe(1)
    expect(second).toBe(1)
    stop()
  })

  test('a single test inside a running batch waits for the batch', async () => {
    // The window the batch counter exists for: the per-row delay button and "test all" hold
    // separate locks, so a user can start one inside the other. Announcing then would sort a
    // half-measured group, which is the reordering this design is meant to prevent.
    const proxies = Array.from({ length: 6 }, (_, index) => node(`n${index}`))

    const batch = delayManager.checkListDelay(proxies as never, 'g', 5000, 2)
    await delayManager.checkDelay(node('single') as never, 'g', 5000)
    await nextFrame()
    expect(settles).toBe(0)

    await batch
    await nextFrame()
    expect(settles).toBe(1)
  })

  test('unsubscribing one listener leaves the others subscribed', async () => {
    let second = 0
    const stop = delayManager.addGroupListener('g', () => {
      second += 1
    })

    unsubscribe()
    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await nextFrame()

    expect(settles).toBe(0)
    expect(second).toBe(1)
    stop()
  })

  test('another group is not disturbed', async () => {
    let other = 0
    const stop = delayManager.addGroupListener('other', () => {
      other += 1
    })

    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await nextFrame()

    expect(settles).toBe(1)
    expect(other).toBe(0)
    stop()
  })
})
