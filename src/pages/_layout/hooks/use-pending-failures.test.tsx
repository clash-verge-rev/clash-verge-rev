// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PendingFailure } from '@/services/cmds'
import { getSnapshotNotices, hideNotice } from '@/services/notice-service'

import { usePendingFailures } from './use-pending-failures'

const getPendingFailures = vi.hoisted(() => vi.fn())
const onFocusChanged = vi.hoisted(() => vi.fn())
const isVisible = vi.hoisted(() => vi.fn())
const isMinimized = vi.hoisted(() => vi.fn())

vi.mock('@/services/cmds', () => ({ getPendingFailures }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged, isVisible, isMinimized }),
}))

let table: PendingFailure[] = []
let onSubscribed: (() => void) | undefined
let onTableChanged: (() => void) | undefined
let focusListener: ((event: { payload: boolean }) => void) | undefined

vi.mock('@/services/events', () => ({
  subscribeVergeEvents: (
    handlers: Record<string, () => void>,
    subscribed?: () => void,
  ) => {
    onTableChanged = handlers['verge://pending-failures-changed']
    onSubscribed = subscribed
    return () => {}
  },
}))

const failure = (sequence: number, detail: string): PendingFailure => ({
  code: 'SYSPROXY_PRIVILEGE_REQUIRED',
  detail,
  operation: 'systemProxyRestore',
  sequence,
})

const shownDetails = () =>
  getSnapshotNotices().map((notice) => notice.i18n?.params?.message)

beforeEach(() => {
  getPendingFailures.mockClear()
  onFocusChanged.mockClear()
  isVisible.mockReset()
  isVisible.mockResolvedValue(true)
  isMinimized.mockReset()
  isMinimized.mockResolvedValue(false)
  table = []
  onSubscribed = undefined
  onTableChanged = undefined
  focusListener = undefined
  getPendingFailures.mockImplementation(() => Promise.resolve(table))
  onFocusChanged.mockImplementation(
    (listener: (event: { payload: boolean }) => void) => {
      focusListener = listener
      return Promise.resolve(() => {})
    },
  )
})

afterEach(() => {
  cleanup()
  getSnapshotNotices().forEach((notice) => hideNotice(notice.id))
})

it('shows a failure that was recorded before the listeners were live', async () => {
  table = [failure(1, 'refused')]
  renderHook(() => usePendingFailures())

  onSubscribed?.()

  await waitFor(() => expect(shownDetails()).toEqual(['refused']))
})

it('shows a failure recorded after the window was already up', async () => {
  renderHook(() => usePendingFailures())
  onSubscribed?.()
  await waitFor(() => expect(getPendingFailures).toHaveBeenCalled())

  table = [failure(1, 'refused')]
  onTableChanged?.()

  await waitFor(() => expect(shownDetails()).toEqual(['refused']))
})

it('does not show the same failure again when asked again', async () => {
  table = [failure(1, 'refused')]
  renderHook(() => usePendingFailures())

  onSubscribed?.()
  await waitFor(() => expect(shownDetails()).toEqual(['refused']))
  onTableChanged?.()
  focusListener?.({ payload: true })

  await waitFor(() => expect(getPendingFailures).toHaveBeenCalledTimes(3))
  expect(shownDetails()).toEqual(['refused'])
})

it('shows the same code again when it has failed again', async () => {
  table = [failure(1, 'refused')]
  renderHook(() => usePendingFailures())
  onSubscribed?.()
  await waitFor(() => expect(shownDetails()).toEqual(['refused']))

  table = [failure(2, 'refused again')]
  onTableChanged?.()

  await waitFor(() => expect(shownDetails()).toEqual(['refused again']))
})

it('reads when the window takes focus', async () => {
  renderHook(() => usePendingFailures())
  onSubscribed?.()
  await waitFor(() => expect(getPendingFailures).toHaveBeenCalled())

  table = [failure(1, 'refused')]
  focusListener?.({ payload: true })

  await waitFor(() => expect(shownDetails()).toEqual(['refused']))
})

it('keeps a failure pending while the window is hidden', async () => {
  isVisible.mockResolvedValue(false)
  table = [failure(1, 'refused')]
  renderHook(() => usePendingFailures())

  onSubscribed?.()
  await waitFor(() => expect(isVisible).toHaveBeenCalled())
  expect(shownDetails()).toEqual([])

  isVisible.mockResolvedValue(true)
  focusListener?.({ payload: true })

  await waitFor(() => expect(shownDetails()).toEqual(['refused']))
})

it('keeps a failure pending while the window is minimised', async () => {
  isMinimized.mockResolvedValue(true)
  table = [failure(1, 'refused')]
  renderHook(() => usePendingFailures())

  onSubscribed?.()
  await waitFor(() => expect(isMinimized).toHaveBeenCalled())
  expect(shownDetails()).toEqual([])

  isMinimized.mockResolvedValue(false)
  focusListener?.({ payload: true })

  await waitFor(() => expect(shownDetails()).toEqual(['refused']))
})

it('keeps a failure pending when the window cannot say what it is doing', async () => {
  isVisible.mockRejectedValue(new Error('no window'))
  table = [failure(1, 'refused')]
  renderHook(() => usePendingFailures())

  onSubscribed?.()
  await waitFor(() => expect(isVisible).toHaveBeenCalled())
  expect(shownDetails()).toEqual([])
})

it('ignores losing focus', async () => {
  renderHook(() => usePendingFailures())
  onSubscribed?.()
  await waitFor(() => expect(getPendingFailures).toHaveBeenCalledTimes(1))

  focusListener?.({ payload: false })

  expect(getPendingFailures).toHaveBeenCalledTimes(1)
})
