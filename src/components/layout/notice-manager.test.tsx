// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import {
  getSnapshotNotices,
  hideNotice,
  showNotice,
} from '@/services/notice-service'

import { NoticeManager } from './notice-manager'

const writeText = vi.fn((_text: string) => Promise.resolve())

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: {
      en: {
        translation: {
          settings: {
            modals: {
              backup: {
                messages: { backupFailed: 'Backup failed: {{error}}' },
              },
            },
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  getSnapshotNotices().forEach((notice) => hideNotice(notice.id))
  writeText.mockClear()
})

const noticeText = () => screen.getByRole('alert').textContent ?? ''

it('renders a failure detail that fits, in full', () => {
  showNotice.error({ code: 'CORE_START_FAILED', detail: 'connection refused' })
  render(<NoticeManager />)

  expect(noticeText()).toContain('connection refused')
})

it('shortens an unbounded detail', () => {
  showNotice.error({
    code: 'SERVICE_INSTALL_FAILED',
    detail: `${'x'.repeat(4000)} tail`,
  })
  render(<NoticeManager />)

  expect(noticeText().length).toBeLessThanOrEqual(501)
  expect(noticeText()).not.toContain('tail')
  expect(noticeText()).toContain('…')
})

it('shortens a detail a caller interpolated into its own message', () => {
  showNotice.error('profiles.page.feedback.notices.emergencyRefreshFailed', {
    message: 'y'.repeat(4000),
  })
  render(<NoticeManager />)

  expect(noticeText().length).toBeLessThanOrEqual(501)
  expect(noticeText()).toContain('…')
})

it('renders a failure a caller interpolated, not [object Object]', () => {
  showNotice.error('settings.modals.backup.messages.backupFailed', {
    error: { code: 'BACKUP_FAILED', detail: 'webdav returned 401' },
  })
  render(<NoticeManager />)

  expect(noticeText()).toBe('Backup failed: webdav returned 401')
})

it('renders a failure inside a descriptor, not [object Object]', () => {
  showNotice.error({
    key: 'settings.modals.backup.messages.backupFailed',
    params: { error: { code: 'BACKUP_FAILED', detail: 'webdav returned 401' } },
  })
  render(<NoticeManager />)

  expect(noticeText()).toBe('Backup failed: webdav returned 401')
})

it('copies the whole detail, not the shortened one', async () => {
  const detail = `${'x'.repeat(4000)} tail`
  showNotice.error({ code: 'SERVICE_INSTALL_FAILED', detail })
  render(<NoticeManager />)

  fireEvent.contextMenu(screen.getByRole('alert'))

  await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
  expect(writeText).toHaveBeenCalledWith(detail)
})

it('copies the whole message when the caller interpolated the detail', async () => {
  const detail = 'y'.repeat(4000)
  showNotice.error('profiles.page.feedback.notices.emergencyRefreshFailed', {
    message: detail,
  })
  render(<NoticeManager />)

  fireEvent.contextMenu(screen.getByRole('alert'))

  await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
  expect(writeText.mock.calls[0]?.[0]).toContain(detail)
})
