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

import type { PendingFailure } from '@/services/cmds'
import { getSnapshotNotices, hideNotice } from '@/services/notice-service'

const reported = (key: string) =>
  getSnapshotNotices().some(
    (notice) =>
      notice.i18n?.key === key ||
      Object.values(notice.i18n?.params ?? {}).some(
        (param) =>
          typeof param === 'object' &&
          param !== null &&
          'key' in param &&
          (param as { key?: unknown }).key === key,
      ),
  )

import { SysproxyPrivilegeDialog } from './sysproxy-privilege-dialog'

const restartCore = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const installService = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const getRuntimeState = vi.hoisted(() => vi.fn())
const getPendingFailures = vi.hoisted(() => vi.fn())
const onFocusChanged = vi.hoisted(() => vi.fn(() => Promise.resolve(() => {})))

vi.mock('@/services/cmds', () => ({
  restartCore,
  installService,
  getRuntimeState,
  getPendingFailures,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged }),
}))

let onSubscribed: (() => void) | undefined
vi.mock('@/services/events', () => ({
  subscribeVergeEvents: (
    _handlers: Record<string, () => void>,
    subscribed?: () => void,
  ) => {
    onSubscribed = subscribed
    return () => {}
  },
}))

const failure = (code: string): PendingFailure => ({
  code,
  detail: 'admin privileges required to modify system proxy',
  operation: 'systemProxyEnable',
  sequence: 1,
})

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
})

afterEach(() => {
  restartCore.mockClear()
  restartCore.mockImplementation(() => Promise.resolve())
  installService.mockClear()
  installService.mockImplementation(() => Promise.resolve())
  getRuntimeState.mockReset()
  getRuntimeState.mockResolvedValue({ mode: 'Service', serviceUsable: true })
  getPendingFailures.mockReset()
  onSubscribed = undefined
  cleanup()
  getSnapshotNotices().forEach((notice) => hideNotice(notice.id))
})

const showing = async (code: string) => {
  getPendingFailures.mockResolvedValue([failure(code)])
  render(<SysproxyPrivilegeDialog />)
  onSubscribed?.()
  await screen.findByRole('dialog')
}

const clickPrimary = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }))

it('offers to install the service when the write was refused', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  expect(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.installService',
    }),
  ).toBeTruthy()
})

it('offers only a restart when the service is already there', async () => {
  await showing('SYSPROXY_SIDECAR_WHILE_SERVICE_READY')

  expect(
    screen.getByRole('button', {
      name: 'settings.sections.proxyControl.actions.switchToServiceMode',
    }),
  ).toBeTruthy()
  expect(
    screen.queryByRole('button', {
      name: 'settings.sections.proxyControl.actions.installService',
    }),
  ).toBeNull()
})

it('installs the service, restarts into it, and says what is left to do', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(installService).toHaveBeenCalledOnce())
  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(
      reported('settings.sections.proxyControl.messages.installedCheckProxy'),
    ).toBe(true),
  )
})

it('does not install again when only the restart is needed', async () => {
  await showing('SYSPROXY_SIDECAR_WHILE_SERVICE_READY')

  clickPrimary('settings.sections.proxyControl.actions.switchToServiceMode')

  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  expect(installService).not.toHaveBeenCalled()
})

it('checks what actually happened rather than trusting the restart', async () => {
  getRuntimeState.mockResolvedValue({ mode: 'Sidecar', serviceUsable: true })
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() =>
    expect(
      reported(
        'settings.sections.proxyControl.messages.installedCoreNotOnService',
      ),
    ).toBe(true),
  )
})

it('closes once the core is on the service, whatever the table still says', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('stays open when the core did not reach the service', async () => {
  getRuntimeState.mockResolvedValue({ mode: 'Sidecar', serviceUsable: false })
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('does not go on to restart when the install itself failed', async () => {
  installService.mockRejectedValue({
    code: 'SERVICE_INSTALL_FAILED',
    detail: 'user cancelled',
  })
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(installService).toHaveBeenCalledOnce())
  expect(restartCore).not.toHaveBeenCalled()
  expect(getRuntimeState).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('closes on “later” without touching the machine', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('layout.components.sysproxyPrivilege.later')

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(installService).not.toHaveBeenCalled()
  expect(restartCore).not.toHaveBeenCalled()
})
