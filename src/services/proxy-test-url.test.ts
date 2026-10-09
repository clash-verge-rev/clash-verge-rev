import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@/services/cmds', () => ({
  getProfiles: vi.fn(),
  patchProfile: vi.fn().mockResolvedValue(undefined),
  syncTrayProxySelection: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))
vi.mock('@/services/notice-service', () => ({ showNotice: { error: vi.fn() } }))

import {
  getProfiles,
  patchProfile,
  syncTrayProxySelection,
} from '@/services/cmds'
import { revalidateQueries } from '@/services/query-client'

import {
  profileTestUrls,
  saveProfileTestUrls,
  commitProfileTestUrl,
} from './proxy-test-url'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('committed edits retain their profile and merge with fresh saved URLs', async () => {
  vi.mocked(getProfiles).mockResolvedValue({
    current: 'new-profile',
    items: [
      {
        uid: 'old-profile',
        latency_test_urls: { untouched: 'https://example.com/' },
      },
    ],
  })
  await commitProfileTestUrl('old-profile', 'A', ' http://localhost/new ')
  expect(patchProfile).toHaveBeenCalledExactlyOnceWith('old-profile', {
    latency_test_urls: {
      untouched: 'https://example.com/',
      A: 'http://localhost/new',
    },
  })
  expect(revalidateQueries).toHaveBeenCalledWith([['getProfiles']])
  expect(syncTrayProxySelection).toHaveBeenCalledOnce()
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
  const first = commitProfileTestUrl(profile.uid, 'A', 'http://localhost/new')
  expect(profileTestUrls(profile).A).toBe('http://localhost/new')
  await vi.advanceTimersByTimeAsync(300)
  expect(profileTestUrls(profile).A).toBe('http://localhost/new')
  const second = commitProfileTestUrl(
    profile.uid,
    'A',
    'http://localhost/newest',
  )
  finish()
  await first
  expect(profileTestUrls(profile).A).toBe('http://localhost/newest')
  await second
  expect(patchProfile).toHaveBeenLastCalledWith(profile.uid, {
    latency_test_urls: { A: 'http://localhost/newest' },
  })
})

test('a failed save preserves the committed input across profile refreshes', async () => {
  const profile = {
    uid: 'failed-profile',
    latency_test_urls: { A: 'http://localhost/old' },
  }
  vi.mocked(getProfiles).mockResolvedValue({ items: [profile] })
  vi.mocked(patchProfile).mockRejectedValueOnce(new Error('save failed'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await commitProfileTestUrl(profile.uid, 'A', 'http://localhost/new')
  expect(profileTestUrls(profile).A).toBe('http://localhost/new')
  await commitProfileTestUrl(profile.uid, 'A', 'http://localhost/new')
  expect(profileTestUrls(profile).A).toBe('http://localhost/old')
  log.mockRestore()
})
