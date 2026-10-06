import { beforeEach, expect, it, vi } from 'vitest'

import {
  getPendingFailures,
  getRuntimeState,
  type RunState,
} from '@/services/cmds'

import { appStoreReducer, initialAppStoreState } from './app-state'
import { createStoreReads } from './store-reads'

vi.mock('@/services/cmds', () => ({
  getRuntimeState: vi.fn(),
  getPendingFailures: vi.fn().mockResolvedValue([]),
  getSidecarFailure: vi.fn().mockResolvedValue({ revision: 0, detail: null }),
}))

beforeEach(() => vi.clearAllMocks())

it('keeps a newer run-state event when an older snapshot returns', async () => {
  let resolve!: (state: RunState) => void
  vi.mocked(getRuntimeState).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  let state = initialAppStoreState
  const reads = createStoreReads((action) => {
    state = appStoreReducer(state, action)
  })
  const pending = reads.readRunState()
  const running = { mode: 'Service' } as RunState
  reads.acceptRunState(running)
  resolve({ mode: 'NotRunning' } as RunState)
  expect(await pending).toBe(running)
  expect(state.runState).toBe(running)
})

it('keeps the newer read when run-state replies arrive in reverse order', async () => {
  let resolveFirst!: (state: RunState) => void
  vi.mocked(getRuntimeState)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r
        }),
    )
    .mockResolvedValueOnce({ mode: 'Service' } as RunState)
  let state = initialAppStoreState
  const reads = createStoreReads((action) => {
    state = appStoreReducer(state, action)
  })
  const first = reads.readRunState()
  const second = reads.readRunState()
  await second
  resolveFirst({ mode: 'NotRunning' } as RunState)
  expect((await first).mode).toBe('Service')
  expect(state.runState?.mode).toBe('Service')
})

it('does not restore cleared pending failures from an older read', async () => {
  let resolveFirst!: (
    failures: Awaited<ReturnType<typeof getPendingFailures>>,
  ) => void
  vi.mocked(getPendingFailures)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r
        }),
    )
    .mockResolvedValueOnce([])
  let state = initialAppStoreState
  const reads = createStoreReads((action) => {
    state = appStoreReducer(state, action)
  })
  reads.readPendingFailures()
  reads.readPendingFailures()
  await Promise.resolve()
  resolveFirst([
    {
      code: 'proxy',
      detail: 'old',
      operation: 'systemProxyEnable',
      sequence: 1,
    },
  ])
  await Promise.resolve()
  expect(state.pendingFailures).toEqual([])
})
