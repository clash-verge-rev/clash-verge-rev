import { afterEach, describe, expect, it } from 'vitest'

import {
  errorDetail,
  getSnapshotNotices,
  hideNotice,
  showNotice,
} from '@/services/notice-service'

/** Return the last notice text that is actually rendered. */
function renderedDetail(): string | undefined {
  const notices = getSnapshotNotices()
  const notice = notices[notices.length - 1]
  if (typeof notice?.message === 'string') return notice.message
  const slot = notice?.i18n?.params?.message
  return typeof slot === 'string' ? slot : undefined
}

afterEach(() => {
  getSnapshotNotices().forEach((notice) => hideNotice(notice.id))
})

describe('command failures reaching a notice', () => {
  it('keeps the detail when the failure is the message', () => {
    showNotice.error({
      code: 'CORE_START_FAILED',
      detail: 'connection refused',
    })

    expect(renderedDetail()).toContain('connection refused')
  })

  it('keeps the detail when a translation key comes first', () => {
    showNotice.error('settings.feedback.errors.clash.startFailed', {
      code: 'CORE_START_FAILED',
      detail: 'connection refused',
    })

    expect(renderedDetail()).toContain('connection refused')
  })

  it('keeps the detail when real translation params come first', () => {
    showNotice.error(
      'settings.feedback.errors.clash.startFailed',
      { name: 'mihomo' },
      { code: 'CORE_START_FAILED', detail: 'connection refused' },
    )

    expect(renderedDetail()).toContain('connection refused')
  })

  it('keeps the detail for a failure that carries no code', () => {
    showNotice.error('settings.feedback.errors.clash.startFailed', {
      detail: 'disk full',
    })

    expect(renderedDetail()).toContain('disk full')
  })
})

describe('errorDetail', () => {
  it('reads the detail out of a command failure', () => {
    expect(errorDetail({ code: 'X', detail: 'legacy TLS not supported' })).toBe(
      'legacy TLS not supported',
    )
  })

  it('passes plain strings through untouched', () => {
    expect(errorDetail('something broke')).toBe('something broke')
  })

  it('still reads an Error, which not every failure path replaces', () => {
    expect(errorDetail(new Error('boom'))).toBe('boom')
  })
})
