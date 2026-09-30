import { beforeEach, expect, it, vi } from 'vitest'

import { useEventBus } from './use-event-bus'

const listen = vi.hoisted(() =>
  vi.fn<
    (name: string, handler: (event: unknown) => void) => Promise<() => void>
  >(() => Promise.resolve(() => {})),
)
const handleNotice = vi.hoisted(() => vi.fn())
const dispatch = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({ listen }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  }),
}))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => effect(),
  }
})
vi.mock('@/store/app-store-context', () => ({
  useAppDispatch: () => dispatch,
}))
vi.mock('@/services/cmds', () => ({
  getPendingFailures: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  listen.mockClear()
  handleNotice.mockClear()
  dispatch.mockClear()
  listen.mockImplementation(() => Promise.resolve(() => {}))
})

it('registers exactly one listener per contract event plus test-all', () => {
  useEventBus(handleNotice)

  const names = listen.mock.calls.map(([name]) => name)
  expect(names).toEqual([
    'verge://refresh-clash-config',
    'verge://refresh-verge-config',
    'verge://refresh-profiles',
    'verge://refresh-proxy-config',
    'verge://notice-message',
    'profile-changed',
    'verge://timer-updated',
    'profile-update-started',
    'profile-update-completed',
    'verge://run-state-changed',
    'verge://pending-failures-changed',
    'verge://test-all',
  ])
  expect(new Set(names).size).toBe(names.length)
})

it('drains event-only state only after every listener is registered', async () => {
  const registrations: Array<() => void> = []
  listen.mockImplementation(
    () =>
      new Promise((resolve) => {
        registrations.push(() => resolve(() => {}))
      }),
  )

  useEventBus(handleNotice)
  await flush()
  expect(handleNotice).not.toHaveBeenCalled()

  for (const resolve of registrations.slice(0, -1)) resolve()
  await flush()
  expect(handleNotice).not.toHaveBeenCalled()

  registrations.at(-1)?.()
  await flush()
  expect(handleNotice).toHaveBeenCalled()
  expect(dispatch).toHaveBeenCalledWith({
    type: 'pendingFailures/loaded',
    failures: [],
  })
})
