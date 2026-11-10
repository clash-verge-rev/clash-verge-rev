import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('tauri-plugin-mihomo-api', () => ({
  delayProxyByName: vi.fn(async () => ({ delay: 120 })),
  healthcheckNodeInProvider: vi.fn(async () => ({ delay: 120 })),
}))

import type { InteractableProxyMember } from '@/types/proxy-view'

import delayManager from './delay'

const node = (
  name: string,
): Extract<InteractableProxyMember, { kind: 'node' }> => ({
  kind: 'node',
  ref: { kind: 'node', name, recordId: `r:${name}` },
  node: {
    recordId: `r:${name}`,
    name,
    type: 'Shadowsocks',
    history: [],
    source: { kind: 'core', proxyName: name },
    udp: false,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
  },
})

let settles = 0
let unsubscribe: () => void
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  settles = 0
  unsubscribe = delayManager.addGroupListener('g', () => {
    settles += 1
  })
})

afterEach(() => unsubscribe())

describe('group delay completion', () => {
  test('notifies once after a batch settles', async () => {
    const proxies = Array.from({ length: 6 }, (_, index) => node(`n${index}`))

    await delayManager.checkListDelay(proxies, 'g', 5000, 2)
    await flush()

    expect(settles).toBe(1)
  })

  test('notifies only listeners for the completed group', async () => {
    let other = 0
    const stop = delayManager.addGroupListener('other', () => {
      other += 1
    })

    await delayManager.checkDelay(node('a'), 'g', 5000)
    await flush()

    expect(settles).toBe(1)
    expect(other).toBe(0)
    stop()
  })
})

describe('profile delay isolation', () => {
  test('notifies both shared-key occurrences and preserves the surviving subscription', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = delayManager.addListener('a', 'g', first)
    const stopSecond = delayManager.addListener('a', 'g', second)
    try {
      delayManager.setDelay('a', 'g', -2)
      await flush()
      stopFirst()
      delayManager.setDelay('a', 'g', 120)
      await flush()
      expect(first.mock.calls.map(([update]) => update.delay)).toEqual([-2])
      expect(second.mock.calls.map(([update]) => update.delay)).toEqual([
        -2, 120,
      ])
    } finally {
      stopFirst()
      stopSecond()
    }
  })

  test('clears cached delays and fences an old batch across a profile switch', async () => {
    delayManager.setProfile('initial')
    delayManager.setDelay('cached', 'g', 900)
    const oldBatch = delayManager.checkListDelay(
      [node('a'), node('not-started')],
      'g',
      5000,
      1,
    )
    delayManager.setProfile('next')
    expect(delayManager.getDelayUpdate('cached', 'g')).toBeUndefined()
    delayManager.setDelay('a', 'g', 42)
    await oldBatch
    await flush()
    expect(delayManager.getDelay('a', 'g')).toBe(42)
    expect(delayManager.getDelayUpdate('not-started', 'g')).toBeUndefined()
  })
})
