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
  test('drops cached and queued results on switch, exposing current history', async () => {
    const listener = vi.fn()
    delayManager.setListener('a', 'g', listener)
    try {
      delayManager.setDelay('a', 'g', 120)
      const previousSnapshot = delayManager.groupDelays('g')
      delayManager.setProfile('initial')
      expect(delayManager.getDelay('a', 'g')).toBe(120)

      delayManager.setProfile('next')
      const current = node('a')
      current.node.history = [{ time: new Date().toISOString(), delay: 42 }]
      expect(delayManager.getDelayUpdate('a', 'g')).toBeUndefined()
      expect(delayManager.getDelayFix(current, 'g')).toBe(42)
      expect(delayManager.groupDelays('g')).not.toBe(previousSnapshot)

      expect(listener).toHaveBeenCalledExactlyOnceWith({
        delay: -1,
        updatedAt: 0,
      })
      await vi.runAllTimersAsync()
      expect(listener).toHaveBeenCalledOnce()
      expect(settles).toBe(1)
    } finally {
      delayManager.removeListener('a', 'g')
    }
  })

  test.each(['success', 'failure'] as const)(
    'ignores an old-profile single test completing with %s',
    async (outcome) => {
      let finish!: () => void
      vi.mocked(delayProxyByName).mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              outcome === 'success'
                ? resolve({ delay: 900 })
                : reject(new Error('old-profile request failed'))
          }),
      )
      const oldCheck = delayManager.checkDelay(node('a'), 'g', 5000)
      delayManager.setProfile('next')
      const newCheck = delayManager.checkDelay(node('a'), 'g', 5000)
      await vi.advanceTimersByTimeAsync(500)
      await newCheck
      await vi.advanceTimersByTimeAsync(1)
      const settledBeforeOldReply = settles

      finish()
      await vi.runAllTimersAsync()
      await oldCheck
      expect(delayManager.getDelay('a', 'g')).toBe(120)
      expect(settles).toBe(settledBeforeOldReply)
    },
  )

  test('stops an old batch without settling a new batch for the same group', async () => {
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

    const oldBatch = delayManager.checkListDelay(
      [node('a'), node('not-started')],
      'g',
      5000,
      1,
    )
    delayManager.setProfile('next')
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
