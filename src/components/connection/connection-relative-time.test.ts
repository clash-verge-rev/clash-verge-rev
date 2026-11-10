import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('dayjs', () => ({ default: () => ({ from: () => '' }) }))
vi.mock('react', () => ({
  memo: (component: unknown) => component,
  useSyncExternalStore: vi.fn((_subscribe, getSnapshot) => getSnapshot()),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps at most one interval while visible and none while hidden or unsubscribed', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  const visibility = Object.assign(new EventTarget(), { hidden: true })
  vi.stubGlobal('document', visibility)
  const { RelativeTime } = await import('./connection-relative-time')
  RelativeTime({ start: '' })
  const [subscribe] = vi.mocked(useSyncExternalStore).mock.calls[0]
  const unsubscribeFirst = subscribe(() => {})
  const unsubscribeSecond = subscribe(() => {})
  expect(vi.getTimerCount()).toBe(0)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(1)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(1)
  unsubscribeFirst()
  unsubscribeSecond()
  expect(vi.getTimerCount()).toBe(0)
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
})
