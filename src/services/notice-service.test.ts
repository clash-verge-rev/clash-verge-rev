import { afterEach, describe, expect, it } from 'vitest'

import {
  boundNoticeText,
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

/** Return the rendered failure notice fields. */
function renderedExplanation() {
  const notices = getSnapshotNotices()
  const i18n = notices[notices.length - 1]?.i18n
  const readString = (value: unknown) =>
    typeof value === 'string' ? value : undefined

  return {
    outerKey: i18n?.key,
    explanationKey: readString(i18n?.params?.prefixKey),
    prefix: readString(i18n?.params?.prefix),
    detail: readString(i18n?.params?.message),
  }
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

describe('system proxy failures the user can be told about', () => {
  it('explains a fallback to a direct connection', () => {
    showNotice.error({
      code: 'SYSPROXY_DIRECT_FALLBACK',
      detail: 'service could not set the proxy',
    })

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: 'settings.feedback.errors.sysproxy.directFallback',
      prefix: undefined,
      detail: 'service could not set the proxy',
    })
  })

  it('explains a refused privileged write', () => {
    showNotice.error({
      code: 'SYSPROXY_PRIVILEGE_REQUIRED',
      detail: 'admin privileges required to modify system proxy',
    })

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: 'settings.feedback.errors.sysproxy.privilegeRequired',
      prefix: undefined,
      detail: 'admin privileges required to modify system proxy',
    })
  })

  it('explains the cause even when the caller names the operation', () => {
    showNotice.error(
      'layout.components.serviceMigration.errors.restartFailed',
      {
        code: 'SYSPROXY_PRIVILEGE_REQUIRED',
        detail: 'admin privileges required to modify system proxy',
      },
    )

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: 'settings.feedback.errors.sysproxy.privilegeRequired',
      prefix: undefined,
      detail: 'admin privileges required to modify system proxy',
    })
  })

  it('leaves the caller key in place for a code nothing explains', () => {
    showNotice.error(
      'layout.components.serviceMigration.errors.restartFailed',
      {
        code: 'SOME_UNMAPPED_CODE',
        detail: 'connection refused',
      },
    )

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: 'layout.components.serviceMigration.errors.restartFailed',
      prefix: undefined,
      detail: 'connection refused',
    })
  })

  it('leaves literal caller text in place, mapped code or not', () => {
    showNotice.error('Could not reconnect the profile', {
      code: 'SYSPROXY_PRIVILEGE_REQUIRED',
      detail: 'admin privileges required to modify system proxy',
    })

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: undefined,
      prefix: 'Could not reconnect the profile',
      detail: 'admin privileges required to modify system proxy',
    })
  })

  it('explains a core running in the wrong place', () => {
    showNotice.error({
      code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
      detail: 'admin privileges required to modify system proxy',
    })

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey:
        'settings.feedback.errors.sysproxy.sidecarWhileServiceReady',
      prefix: undefined,
      detail: 'admin privileges required to modify system proxy',
    })
  })

  it('explains a guard that gave up', () => {
    showNotice.error({
      code: 'SYSPROXY_GUARD_STOPPED',
      detail: 'service refused three times running',
    })

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: 'settings.feedback.errors.sysproxy.guardStopped',
      prefix: undefined,
      detail: 'service refused three times running',
    })
  })

  it('falls back to the generic message for a code nothing maps', () => {
    showNotice.error({ code: 'SYSPROXY_NOT_A_REAL_CODE', detail: 'boom' })

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.prefixedRaw',
      explanationKey: 'shared.feedback.errors.operationFailed',
      prefix: undefined,
      detail: 'boom',
    })
  })
})

describe('boundNoticeText', () => {
  it('leaves text that fits exactly at the limit alone', () => {
    const exact = 'x'.repeat(500)

    expect(boundNoticeText(exact)).toBe(exact)
  })

  it('marks text it had to shorten', () => {
    expect(boundNoticeText('x'.repeat(501))).toBe(`${'x'.repeat(500)}…`)
  })

  it('does not cut a surrogate pair in half', () => {
    expect(boundNoticeText('🙂'.repeat(600))).toBe(`${'🙂'.repeat(500)}…`)
  })

  it('does not mistake a long message for a translation key', () => {
    const message = `a.${'b'.repeat(400)}`
    showNotice.error(message)

    expect(renderedExplanation()).toEqual({
      outerKey: 'shared.feedback.notices.raw',
      explanationKey: undefined,
      prefix: undefined,
      detail: message,
    })
  })

  it('does not leave a space before the ellipsis', () => {
    expect(boundNoticeText(`${'x'.repeat(498)}  yyy`)).toBe(
      `${'x'.repeat(498)}…`,
    )
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
