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
const restartCore = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@/services/cmds', () => ({ restartCore }))
vi.mock('@/utils/get-system', () => ({ default: () => 'macos' }))

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
  restartCore.mockClear()
  restartCore.mockImplementation(() => Promise.resolve())
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

it('offers to fix a core running in the wrong place, and stops offering once it is fixed', async () => {
  showNotice.error({
    code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
    detail: 'admin privileges required to modify system proxy',
  })
  render(<NoticeManager />)

  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.switchToServiceMode',
    }),
  )

  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0))
})

it('keeps the notice when the fix itself fails', async () => {
  restartCore.mockRejectedValue({ code: 'CORE_RESTART_FAILED', detail: 'no' })
  showNotice.error({
    code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
    detail: 'admin privileges required to modify system proxy',
  })
  render(<NoticeManager />)

  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.switchToServiceMode',
    }),
  )

  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  expect(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.switchToServiceMode',
    }),
  ).toBeTruthy()
})

it('does not let a notice offering a fix expire while the user reads it', () => {
  showNotice.error({
    code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
    detail: 'admin privileges required to modify system proxy',
  })

  expect(getSnapshotNotices().at(-1)?.duration).toBe(0)
})

it('leaves the ordinary lifetime alone where there is nothing to offer', () => {
  showNotice.error({ code: 'CORE_START_FAILED', detail: 'connection refused' })

  expect(getSnapshotNotices().at(-1)?.duration).toBeGreaterThan(0)
})

it('does not offer a fix it has none for', async () => {
  showNotice.error({ code: 'CORE_START_FAILED', detail: 'connection refused' })
  render(<NoticeManager />)

  expect(screen.getAllByRole('button')).toHaveLength(1)
})

it('finds the code a caller interpolated into its own message', async () => {
  showNotice.error('settings.modals.backup.messages.backupFailed', {
    error: {
      code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
      detail: 'webdav returned 401',
    },
  })
  render(<NoticeManager />)

  expect(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.switchToServiceMode',
    }),
  ).toBeTruthy()
})

it('dismisses by code, so a replacement does not survive the fix', async () => {
  let finishRestart: (() => void) | undefined
  restartCore.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRestart = () => resolve()
      }),
  )
  showNotice.error({
    code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
    detail: 'first',
  })
  render(<NoticeManager />)

  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.switchToServiceMode',
    }),
  )
  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())

  showNotice.error({
    code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
    detail: 'second',
  })
  finishRestart?.()

  await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0))
})

it('shows one notice per code, replacing rather than stacking', async () => {
  showNotice.error({ code: 'SYSPROXY_PRIVILEGE_REQUIRED', detail: 'first' })
  showNotice.error({ code: 'SYSPROXY_PRIVILEGE_REQUIRED', detail: 'second' })
  render(<NoticeManager />)

  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByRole('alert').textContent).toContain('second')
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
