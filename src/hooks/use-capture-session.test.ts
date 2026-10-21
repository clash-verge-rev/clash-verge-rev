import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import * as capture from '@/services/capture'

import { useCaptureSession } from './use-capture-session'

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as (() => () => void)[],
}))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.states.push(initial) - 1
    return [
      initial,
      (next: unknown) => {
        harness.states[index] =
          typeof next === 'function' ? next(harness.states[index]) : next
      },
    ]
  },
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => harness.effects.push(effect),
}))
vi.mock('@/services/capture', () => ({
  getCaptureStatus: vi.fn(),
  getCaptureSettings: vi.fn(),
  listCaptureFlows: vi.fn(),
  getCaptureDomains: vi.fn(),
  updateCaptureSettings: vi.fn(),
  addCaptureRule: vi.fn(),
  removeCaptureRule: vi.fn(),
  getCaptureFlowCount: vi.fn(),
  clearCaptureFlows: vi.fn(),
  startCapture: vi.fn(),
  stopCapture: vi.fn(),
  waitForCaptureChanges: vi.fn(),
}))
vi.mock('@/services/notice-service', () => ({ showNotice: { error: vi.fn() } }))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

const running = { running: true, proxy_port: 17891, admin_url: null }
const initial = { enabled: false, capture_all: false, rules: [] }
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  harness.states = []
  harness.effects = []
  vi.mocked(capture.getCaptureStatus).mockResolvedValue(running)
  vi.mocked(capture.getCaptureSettings).mockResolvedValue(initial)
  vi.mocked(capture.getCaptureDomains).mockResolvedValue([])
  vi.mocked(capture.listCaptureFlows).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pages: 1,
    page_size: 20,
  })
})
afterEach(() => vi.useRealTimers())

it('ignores a settings snapshot that started before a successful mutation', async () => {
  let finishRead!: (value: typeof initial) => void
  vi.mocked(capture.getCaptureSettings).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve
      }),
  )
  const session = useCaptureSession()
  const cleanup = harness.effects[0]()
  await flush()
  const updated = { ...initial, enabled: true }
  vi.mocked(capture.updateCaptureSettings).mockResolvedValue(updated)
  await session.setCapturing({ enabled: true })
  finishRead(initial)
  await flush()
  expect(harness.states[1]).toEqual(updated)
  cleanup()
})

it('waits for a refresh to finish before scheduling the next one', async () => {
  let finishRead!: (value: typeof running) => void
  vi.mocked(capture.getCaptureStatus).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve
      }),
  )
  useCaptureSession()
  const cleanup = harness.effects[0]()
  await vi.advanceTimersByTimeAsync(10000)
  expect(capture.getCaptureStatus).toHaveBeenCalledTimes(1)
  finishRead(running)
  await flush()
  await vi.advanceTimersByTimeAsync(2000)
  expect(capture.getCaptureStatus).toHaveBeenCalledTimes(2)
  cleanup()
})

it('preserves independent setting changes queued together', async () => {
  let settings = initial
  vi.mocked(capture.getCaptureSettings).mockImplementation(async () => settings)
  vi.mocked(capture.updateCaptureSettings).mockImplementation(
    async (enabled, captureAll) => {
      settings = { ...settings, enabled, capture_all: captureAll }
      return settings
    },
  )
  const session = useCaptureSession()
  await Promise.all([
    session.setCapturing({ enabled: true }),
    session.setCapturing({ capture_all: true }),
  ])
  expect(capture.updateCaptureSettings).toHaveBeenNthCalledWith(1, true, false)
  expect(capture.updateCaptureSettings).toHaveBeenNthCalledWith(2, true, true)
  expect(harness.states[1]).toEqual({
    ...initial,
    enabled: true,
    capture_all: true,
  })
})
