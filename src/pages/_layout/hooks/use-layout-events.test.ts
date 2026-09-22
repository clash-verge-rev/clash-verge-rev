import { beforeEach, expect, it, vi } from 'vitest'

import { takeDnsOverrideNotice, takeServiceRepairNotice } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import { requestService } from '@/services/service-request'

import { handleNoticeMessage } from '../utils/notification-handlers'

import { useLayoutEvents } from './use-layout-events'

vi.mock('react', () => ({ useEffect: (effect: () => void) => effect() }))
vi.mock('@/hooks/use-profiles', () => ({ revalidateProfiles: vi.fn() }))
vi.mock('@/hooks/use-system-state', () => ({ runStateQueryKey: ['state'] }))
vi.mock('@/services/events', () => ({ subscribeVergeEvents: vi.fn() }))
vi.mock('@/services/cmds', () => ({
  takeDiscardedKeysNotice: vi.fn().mockResolvedValue(null),
  takeDnsOverrideNotice: vi.fn(),
  takeServiceFallbackNotice: vi.fn().mockResolvedValue(false),
  takeServiceRepairNotice: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/services/service-request', () => ({ requestService: vi.fn() }))
vi.mock('@/services/notice-service', () => ({
  showNotice: { info: vi.fn() },
}))
vi.mock('@/services/query-client', () => ({
  revalidateQueries: vi.fn(),
  setCacheData: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
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
