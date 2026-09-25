import { beforeEach, expect, it, vi } from 'vitest'

import {
  type RunState,
  getCoreStartupError,
  takeDnsOverrideNotice,
  takeServiceRepairNotice,
} from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import { requestService } from '@/services/service-request'

import { useLayoutEvents } from './use-layout-events'

let handleNoticeMessage: typeof import('../utils/notification-handlers').handleNoticeMessage

const nativeWindow = vi.hoisted(() => ({
  isVisible: vi.fn().mockResolvedValue(true),
  isMinimized: vi.fn().mockResolvedValue(false),
  onFocusChanged: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => nativeWindow,
}))
vi.mock('react', () => ({ useEffect: (effect: () => void) => effect() }))
vi.mock('@/hooks/use-profiles', () => ({ revalidateProfiles: vi.fn() }))
vi.mock('@/hooks/use-system-state', () => ({ runStateQueryKey: ['state'] }))
vi.mock('@/services/events', () => ({ subscribeVergeEvents: vi.fn() }))
vi.mock('@/services/cmds', () => ({
  getCoreStartupError: vi.fn().mockResolvedValue(null),
  takeDiscardedKeysNotice: vi.fn().mockResolvedValue(null),
  takeDnsOverrideNotice: vi.fn().mockResolvedValue(false),
  takeServiceFallbackNotice: vi.fn().mockResolvedValue(false),
  takeServiceRepairNotice: vi.fn().mockResolvedValue(false),
  takeServiceOwnerNotice: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/services/service-request', () => ({ requestService: vi.fn() }))
vi.mock('@/services/notice-service', () => ({
  showNotice: { info: vi.fn(), error: vi.fn() },
}))
vi.mock('@/services/query-client', () => ({
  revalidateQueries: vi.fn(),
  setCacheData: vi.fn(),
}))

beforeEach(async () => {
  vi.resetModules()
  ;({ handleNoticeMessage } = await import('../utils/notification-handlers'))
  vi.clearAllMocks()
  vi.mocked(getCoreStartupError).mockResolvedValue(null)
  nativeWindow.isVisible.mockResolvedValue(true)
  nativeWindow.isMinimized.mockResolvedValue(false)
})

it('does not replay a recovered startup error after WebView recreation', async () => {
  vi.mocked(getCoreStartupError).mockResolvedValue({
    kind: 'startFailed',
    detail: 'startup failed',
  })
  handleNoticeMessage('core_start::error', '', (key) => key, vi.fn())
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(showNotice.error).toHaveBeenCalledOnce()

  vi.mocked(getCoreStartupError).mockResolvedValue(null)
  vi.resetModules()
  const recreated = await import('../utils/notification-handlers')
  recreated.handleNoticeMessage('core_start::error', '', (key) => key, vi.fn())
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(showNotice.error).toHaveBeenCalledOnce()
})

it.each([
  ['hidden', false, false],
  ['minimized', true, true],
] as const)(
  'keeps a %s-window startup error until the window is restored',
  async (_state, visible, minimized) => {
    const detail = 'startup failed'
    nativeWindow.isVisible.mockResolvedValue(visible)
    nativeWindow.isMinimized.mockResolvedValue(minimized)
    vi.mocked(getCoreStartupError).mockResolvedValue({
      kind: 'startFailed',
      detail,
    })
    useLayoutEvents(([status, message]) => {
      handleNoticeMessage(status, message, (key) => key, vi.fn())
    })
    const [handlers, onSubscribed] =
      vi.mocked(subscribeVergeEvents).mock.calls[0]
    onSubscribed?.()
    handlers['verge://notice-message']?.(['core_start::error', ''])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(showNotice.error).not.toHaveBeenCalled()
    nativeWindow.isVisible.mockResolvedValue(true)
    nativeWindow.isMinimized.mockResolvedValue(false)
    const onFocus = nativeWindow.onFocusChanged.mock.calls[0][0]
    onFocus({ payload: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(showNotice.error).toHaveBeenCalledExactlyOnceWith(
      'settings.feedback.errors.clash.startFailed',
      detail,
    )
  },
)

it('delivers an early core startup failure once after listeners mount', async () => {
  const detail = 'could not open core execution mutex: access denied'
  vi.mocked(getCoreStartupError).mockResolvedValue({
    kind: 'startFailed',
    detail,
  })
  useLayoutEvents(([status, message]) => {
    handleNoticeMessage(status, message, (key) => key, vi.fn())
  })
  const [handlers, onSubscribed] = vi.mocked(subscribeVergeEvents).mock.calls[0]
  onSubscribed?.()
  handlers['verge://notice-message']?.(['core_start::error', ''])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(showNotice.error).toHaveBeenCalledExactlyOnceWith(
    'settings.feedback.errors.clash.startFailed',
    detail,
  )
})

it('shows the same core failure again after the core has started in between', async () => {
  const { useLayoutEvents } = await import('./use-layout-events')
  const failure = { kind: 'serviceCoreStopped', detail: 'stopped' } as const
  vi.mocked(getCoreStartupError).mockResolvedValue(failure)
  useLayoutEvents(([status, message]) => {
    handleNoticeMessage(status, message, (key) => key, vi.fn())
  })
  const [handlers] = vi.mocked(subscribeVergeEvents).mock.calls[0]
  handlers['verge://notice-message']?.(['core_start::error', ''])
  await new Promise((resolve) => setTimeout(resolve, 0))

  // The core started and stopped again before the window handled either event.
  handlers['verge://run-state-changed']?.({ mode: 'Service' } as RunState)
  handlers['verge://notice-message']?.(['core_start::error', ''])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(showNotice.error).toHaveBeenCalledTimes(2)
})

it('drains a DNS notice after listeners mount without duplicating its live event', async () => {
  vi.mocked(takeDnsOverrideNotice)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false)

  useLayoutEvents(([status, message]) => {
    handleNoticeMessage(status, message, (key) => key, vi.fn())
  })

  expect(takeDnsOverrideNotice).not.toHaveBeenCalled()
  const [handlers, onSubscribed] = vi.mocked(subscribeVergeEvents).mock.calls[0]
  onSubscribed?.()
  expect(takeDnsOverrideNotice).toHaveBeenCalledOnce()
  handlers['verge://notice-message']?.(['dns_override::auto_disabled', ''])
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(showNotice.info).toHaveBeenCalledExactlyOnceWith(
    'settings.modals.dns.protection.autoDisabled',
  )
  expect(revalidateQueries).toHaveBeenCalledWith([
    ['getRuntimeState'],
    ['getVergeConfig'],
  ])
})

it('offers service reinstallation for a startup path refusal even before listeners mount', async () => {
  vi.mocked(takeServiceRepairNotice)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false)

  useLayoutEvents(([status, message]) => {
    handleNoticeMessage(status, message, (key) => key, vi.fn())
  })

  const [handlers, onSubscribed] = vi.mocked(subscribeVergeEvents).mock.calls[0]
  onSubscribed?.()
  handlers['verge://notice-message']?.(['service_core::repair_required', ''])
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(requestService).toHaveBeenCalledExactlyOnceWith({
    reason: 'serviceLocationRefused',
  })
})
