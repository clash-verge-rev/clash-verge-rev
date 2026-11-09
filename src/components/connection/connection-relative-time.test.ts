import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

dayjs.extend(relativeTime)

vi.mock('react', () => ({
  memo: (component: unknown) => component,
  useSyncExternalStore: vi.fn((_subscribe, getSnapshot) => getSnapshot()),
}))

let visibility: EventTarget & { hidden: boolean }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  visibility = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('document', visibility)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('shares one clock, stops while hidden, refreshes on visibility, and cleans up the last subscriber', async () => {
  const { RelativeTime } = await import('./connection-relative-time')
  RelativeTime({ start: '2026-01-01T00:00:00Z' })
  const [subscribe, getSnapshot] = vi.mocked(useSyncExternalStore).mock.calls[0]
  const first = vi.fn()
  const second = vi.fn()
  const unsubscribeFirst = subscribe(first)
  const unsubscribeSecond = subscribe(second)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(5_000)
  expect(first).toHaveBeenCalledOnce()
  expect(second).toHaveBeenCalledOnce()

  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(60_000)
  expect(first).toHaveBeenCalledOnce()
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(getSnapshot()).toBe(Date.now())
  expect(first).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(1)
  unsubscribeFirst()
  expect(vi.getTimerCount()).toBe(1)
  unsubscribeSecond()
  expect(vi.getTimerCount()).toBe(0)
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
  expect(second).toHaveBeenCalledTimes(2)
})

it('does not start a clock when mounted hidden', async () => {
  visibility.hidden = true
  const { RelativeTime } = await import('./connection-relative-time')
  RelativeTime({ start: '2026-01-01T00:00:00Z' })
  const [subscribe] = vi.mocked(useSyncExternalStore).mock.calls[0]
  const unsubscribe = subscribe(vi.fn())
  expect(vi.getTimerCount()).toBe(0)
  unsubscribe()
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
})
