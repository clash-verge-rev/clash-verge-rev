import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Stub only the delay API; these tests cover group-settle notification granularity.
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
    // A single-proxy retest must invalidate delay sorting.
    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await nextFrame()

    expect(settles).toBe(1)
  })

  test('a batch settles the group once, however many proxies it covered', async () => {
    // A batch announces once to avoid reordering rows as individual results arrive.
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
    // Multiple views must not replace one another's group subscriptions.
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
    // Nested batches must wait for the outermost settle before announcing.
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
