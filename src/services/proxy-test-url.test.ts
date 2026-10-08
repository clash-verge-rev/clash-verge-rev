import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@/services/cmds', () => ({
  getProfiles: vi.fn(),
  patchProfile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))
vi.mock('@/services/notice-service', () => ({ showNotice: { error: vi.fn() } }))

import { getProfiles, patchProfile } from '@/services/cmds'
import { revalidateQueries } from '@/services/query-client'

import {
  profileTestUrls,
  saveProfileTestUrls,
  scheduleProfileTestUrl,
} from './proxy-test-url'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('debounced edits retain their profile and merge with fresh saved URLs', async () => {
  vi.useFakeTimers()
  vi.mocked(getProfiles).mockResolvedValue({
    current: 'new-profile',
    items: [
      {
        uid: 'old-profile',
        latency_test_urls: { untouched: 'https://example.com/' },
      },
    ],
  })
  scheduleProfileTestUrl('old-profile', 'A', 'http://localhost/old')
  scheduleProfileTestUrl('old-profile', 'B', 'http://localhost/b')
  scheduleProfileTestUrl('old-profile', 'A', ' http://localhost/new ')
  await vi.advanceTimersByTimeAsync(300)
  expect(patchProfile).toHaveBeenCalledExactlyOnceWith('old-profile', {
    latency_test_urls: {
      untouched: 'https://example.com/',
      A: 'http://localhost/new',
      B: 'http://localhost/b',
    },
  })
  expect(revalidateQueries).toHaveBeenCalledWith([['getProfiles']])
})

test('migration cannot overwrite a previously saved or cleared override', async () => {
  vi.mocked(getProfiles).mockResolvedValue({
    items: [{ uid: 'p', latency_test_urls: { A: '' } }],
  })
  await saveProfileTestUrls('p', { A: 'http://localhost/stale' }, true)
  expect(patchProfile).not.toHaveBeenCalled()
})

test('pending edits survive a reload and older save acknowledgements', async () => {
  vi.useFakeTimers()
  const profile = {
    uid: 'pending-profile',
    latency_test_urls: { A: 'http://localhost/old' },
  }
  vi.mocked(getProfiles).mockResolvedValue({ items: [profile] })
  let finish!: () => void
  vi.mocked(patchProfile).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  scheduleProfileTestUrl(profile.uid, 'A', 'http://localhost/new')
  expect(profileTestUrls(profile).A).toBe('http://localhost/new')
  await vi.advanceTimersByTimeAsync(300)
  expect(profileTestUrls(profile).A).toBe('http://localhost/new')
  scheduleProfileTestUrl(profile.uid, 'A', 'http://localhost/newest')
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(profileTestUrls(profile).A).toBe('http://localhost/newest')
  await vi.advanceTimersByTimeAsync(300)
  expect(patchProfile).toHaveBeenLastCalledWith(profile.uid, {
    latency_test_urls: { A: 'http://localhost/newest' },
  })
})
