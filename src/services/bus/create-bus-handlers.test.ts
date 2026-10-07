import { beforeEach, expect, it, vi } from 'vitest'

import {
  type RunState,
  getCoreStartupError,
  takeDnsOverrideNotice,
  takeServiceFallbackNotice,
  takeServiceRepairNotice,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import { requestService } from '@/services/service-request'
import type { AppStoreAction } from '@/store/app-state'

const nativeWindow = vi.hoisted(() => ({
  isVisible: vi.fn().mockResolvedValue(true),
  isMinimized: vi.fn().mockResolvedValue(false),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => nativeWindow,
}))
vi.mock('@/services/cmds', () => ({
  getCoreStartupError: vi.fn().mockResolvedValue(null),
  getPendingFailures: vi.fn().mockResolvedValue([]),
  takeDiscardedKeysNotice: vi.fn().mockResolvedValue(null),
  takeDnsOverrideNotice: vi.fn().mockResolvedValue(false),
  takeServiceFallbackNotice: vi.fn().mockResolvedValue(null),
  takeServiceRepairNotice: vi.fn().mockResolvedValue(false),
  takeServiceOwnerNotice: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/services/service-request', () => ({ requestService: vi.fn() }))
vi.mock('@/services/notice-service', () => ({
  showNotice: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/services/query-client', () => ({
  revalidateQueries: vi.fn(),
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// Everything (bus + notice handlers) comes from one fresh module registry per
// test: startup-error dedup state is module-scoped in notice-handlers.
const mountBus = async () => {
  vi.resetModules()
  const [{ createEventBus }, { handleNoticeMessage: notice }] =
    await Promise.all([
      import('./create-bus-handlers'),
      import('@/services/notice-handlers'),
    ])
  const dispatch = vi.fn<(action: AppStoreAction) => void>()
  return createEventBus({
    dispatch,
    handleNotice: ([status, message]: [string, string]) => {
      notice(status, message, (key) => key, vi.fn())
    },
    revalidateKeys: (keys) => void revalidateQueries(keys.map((key) => [key])),
    readPendingFailures: () => {},
    readRunState: () => {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCoreStartupError).mockResolvedValue(null)
  nativeWindow.isVisible.mockResolvedValue(true)
  nativeWindow.isMinimized.mockResolvedValue(false)
})

it('does not replay a recovered startup error after WebView recreation', async () => {
  const first = await import('@/services/notice-handlers')
  vi.mocked(getCoreStartupError).mockResolvedValue({
    kind: 'startFailed',
    detail: 'startup failed',
  })
  first.handleNoticeMessage('core_start::error', '', (key) => key, vi.fn())
  await flush()
  expect(showNotice.error).toHaveBeenCalledOnce()

  // Mocked modules share one instance across resetModules; the notice-handlers
  // module state is what a WebView recreation actually resets.
  vi.mocked(getCoreStartupError).mockResolvedValue(null)
  vi.resetModules()
  const recreated = await import('@/services/notice-handlers')
  recreated.handleNoticeMessage('core_start::error', '', (key) => key, vi.fn())
  await flush()
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
    const bus = await mountBus()
    bus.onSubscribed()
    bus.handlers['verge://notice-message'](['core_start::error', ''])
    await flush()
    expect(showNotice.error).not.toHaveBeenCalled()
    nativeWindow.isVisible.mockResolvedValue(true)
    nativeWindow.isMinimized.mockResolvedValue(false)
    bus.onWindowFocus()
    await flush()
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
  const bus = await mountBus()
  bus.onSubscribed()
  bus.handlers['verge://notice-message'](['core_start::error', ''])
  await flush()
  expect(showNotice.error).toHaveBeenCalledExactlyOnceWith(
    'settings.feedback.errors.clash.startFailed',
    detail,
  )
})

it('shows the same core failure again after the core has started in between', async () => {
  const failure = { kind: 'serviceCoreStopped', detail: 'stopped' } as const
  vi.mocked(getCoreStartupError).mockResolvedValue(failure)
  const bus = await mountBus()
  bus.handlers['verge://notice-message'](['core_start::error', ''])
  await flush()

  // The core started and stopped again before the window handled either event.
  bus.handlers['verge://run-state-changed']({ mode: 'Service' } as RunState)
  bus.handlers['verge://notice-message'](['core_start::error', ''])
  await flush()
  expect(showNotice.error).toHaveBeenCalledTimes(2)
})

it('drains a DNS notice after listeners mount without duplicating its live event', async () => {
  vi.mocked(takeDnsOverrideNotice)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false)

  const bus = await mountBus()

  expect(takeDnsOverrideNotice).not.toHaveBeenCalled()
  bus.onSubscribed()
  expect(takeDnsOverrideNotice).toHaveBeenCalledOnce()
  bus.handlers['verge://notice-message'](['dns_override::auto_disabled', ''])
  await flush()

  expect(showNotice.info).toHaveBeenCalledExactlyOnceWith(
    'settings.modals.dns.protection.autoDisabled',
  )
  expect(revalidateQueries).toHaveBeenCalledWith([['getVergeConfig']])
})

it('offers service reinstallation for a startup path refusal even before listeners mount', async () => {
  vi.mocked(takeServiceRepairNotice)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false)

  const bus = await mountBus()

  bus.onSubscribed()
  bus.handlers['verge://notice-message'](['service_core::repair_required', ''])
  await flush()

  expect(requestService).toHaveBeenCalledExactlyOnceWith({
    reason: 'serviceLocationRefused',
  })
})

it('explains a startup core rejection instead of the generic fallback notice', async () => {
  const reason =
    'approved core was rejected: core path "C:\\" has an untrusted write ACE'
  vi.mocked(takeServiceFallbackNotice)
    .mockResolvedValueOnce({ kind: 'coreRejected', reason })
    .mockResolvedValue(null)

  const bus = await mountBus()
  bus.onSubscribed()
  bus.handlers['verge://notice-message'](['service_core::sidecar_fallback', ''])
  await flush()

  expect(showNotice.warning).toHaveBeenCalledExactlyOnceWith(
    'settings.feedback.notifications.clashService.permissionFallback',
    { reason },
    0,
  )
})
