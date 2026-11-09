import { delayProxyByName } from 'tauri-plugin-mihomo-api'
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(delayProxyByName).mockReset().mockResolvedValue({ delay: 120 })
  delayManager.setProfile('initial')
  settles = 0
  unsubscribe = delayManager.addGroupListener('g', () => {
    settles += 1
  })
})

afterEach(() => {
  unsubscribe()
  vi.useRealTimers()
})

describe('group delay completion', () => {
  test('notifies once after a batch settles', async () => {
    const proxies = Array.from({ length: 6 }, (_, index) => node(`n${index}`))

    const checking = delayManager.checkListDelay(proxies, 'g', 5000, 2)
    await vi.runAllTimersAsync()
    await checking

    expect(settles).toBe(1)
  })

  test('notifies only listeners for the completed group', async () => {
    let other = 0
    const stop = delayManager.addGroupListener('other', () => {
      other += 1
    })

    const checking = delayManager.checkDelay(node('a'), 'g', 5000)
    await vi.runAllTimersAsync()
    await checking

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
      const checking = delayManager.checkDelay(node('a'), 'g', 5000)
      await vi.runAllTimersAsync()
      await checking
      delayManager.setProfile('next')
      stopFirst()
      const nextCheck = delayManager.checkDelay(node('a'), 'g', 5000)
      await vi.runAllTimersAsync()
      await nextCheck
      expect(first.mock.calls.map(([update]) => update.delay)).toEqual([
        -2, 120, -1,
      ])
      expect(second.mock.calls.map(([update]) => update.delay)).toEqual([
        -2, 120, -1, -2, 120,
      ])
    } finally {
      stopFirst()
      stopSecond()
    }
  })

  test('clears cached delays and fences an old batch across a profile switch', async () => {
    let finishOld!: (result: { delay: number }) => void
    let finishNew!: (result: { delay: number }) => void
    vi.mocked(delayProxyByName)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve
          }),
      )

    delayManager.setDelay('cached', 'g', 900)
    const oldBatch = delayManager.checkListDelay(
      [node('a'), node('not-started')],
      'g',
      5000,
      1,
    )
    delayManager.setProfile('next')
    expect(delayManager.getDelayUpdate('cached', 'g')).toBeUndefined()
    const current = node('a')
    current.node.history = [{ time: new Date().toISOString(), delay: 42 }]
    expect(delayManager.getDelayFix(current, 'g')).toBe(42)
    const newBatch = delayManager.checkListDelay([node('a')], 'g', 5000)
    await vi.advanceTimersByTimeAsync(1)
    const settledAfterSwitch = settles

    finishOld({ delay: 900 })
    await vi.advanceTimersByTimeAsync(500)
    await oldBatch
    expect(delayProxyByName).toHaveBeenCalledTimes(2)
    expect(delayManager.getDelay('a', 'g')).toBe(-2)
    expect(delayManager.getDelayUpdate('not-started', 'g')).toBeUndefined()
    expect(settles).toBe(settledAfterSwitch)

    finishNew({ delay: 42 })
    await vi.runAllTimersAsync()
    await newBatch
    expect(delayManager.getDelay('a', 'g')).toBe(42)
    expect(settles).toBe(settledAfterSwitch + 1)
  })
})
