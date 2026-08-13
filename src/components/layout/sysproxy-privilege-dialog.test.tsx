// @vitest-environment jsdom
import {
  act,
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
import { clearServiceRequest, requestService } from '@/services/service-request'

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
const patchVergeConfig = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const onFocusChanged = vi.hoisted(() => vi.fn(() => Promise.resolve(() => {})))

vi.mock('@/services/cmds', () => ({
  restartCore,
  installService,
  getRuntimeState,
  getPendingFailures,
  patchVergeConfig,
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

const failure = (
  code: string,
  operation: PendingFailure['operation'] = 'systemProxyEnable',
): PendingFailure => ({
  code,
  detail: 'admin privileges required to modify system proxy',
  operation,
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
  patchVergeConfig.mockClear()
  patchVergeConfig.mockImplementation(() => Promise.resolve())
  onSubscribed = undefined
  clearServiceRequest()
  cleanup()
  getSnapshotNotices().forEach((notice) => hideNotice(notice.id))
})

const showing = async (
  code: string,
  operation: PendingFailure['operation'] = 'systemProxyEnable',
) => {
  getPendingFailures.mockResolvedValue([failure(code, operation)])
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

it('installs the service, restarts into it, and makes the request again', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(installService).toHaveBeenCalledOnce())
  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(patchVergeConfig).toHaveBeenCalledWith({
      enable_system_proxy: true,
    }),
  )
  await waitFor(() =>
    expect(
      reported(
        'settings.sections.proxyControl.messages.installedProxyRestored',
      ),
    ).toBe(true),
  )
})

it('replays the direction that was asked for, not always “on”', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED', 'systemProxyDisable')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() =>
    expect(patchVergeConfig).toHaveBeenCalledWith({
      enable_system_proxy: false,
    }),
  )
})

it('changes nothing when nobody asked for a proxy state', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED', 'systemProxyRestore')

  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  expect(patchVergeConfig).not.toHaveBeenCalled()
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

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

it('says which part of the wait it is in, rather than looking stuck', async () => {
  const installing = deferred()
  const restarting = deferred()
  const applying = deferred()
  installService.mockImplementation(() => installing.promise)
  restartCore.mockImplementation(() => restarting.promise)
  patchVergeConfig.mockImplementation(() => applying.promise)

  await showing('SYSPROXY_PRIVILEGE_REQUIRED')
  clickPrimary('settings.sections.proxyControl.actions.installService')

  await screen.findByText('layout.components.sysproxyPrivilege.installing')
  installing.resolve()

  await screen.findByText('layout.components.sysproxyPrivilege.restarting')
  restarting.resolve()

  await screen.findByText('layout.components.sysproxyPrivilege.applying')
  applying.resolve()

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('does not claim to be installing when only a restart is needed', async () => {
  const restarting = deferred()
  restartCore.mockImplementation(() => restarting.promise)

  await showing('SYSPROXY_SIDECAR_WHILE_SERVICE_READY')
  clickPrimary('settings.sections.proxyControl.actions.switchToServiceMode')

  await screen.findByText('layout.components.sysproxyPrivilege.restarting')
  expect(
    screen.queryByText('layout.components.sysproxyPrivilege.installing'),
  ).toBeNull()
  restarting.resolve()
})

it('offers no way out while the installer is holding a password prompt', async () => {
  const installing = deferred()
  installService.mockImplementation(() => installing.promise)

  await showing('SYSPROXY_PRIVILEGE_REQUIRED')
  clickPrimary('settings.sections.proxyControl.actions.installService')

  await screen.findByText('layout.components.sysproxyPrivilege.installing')
  expect(
    screen.queryByRole('button', {
      name: 'layout.components.sysproxyPrivilege.later',
    }),
  ).toBeNull()
  installing.resolve()
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

it('answers a switch that asked outright, with no failure to go on', async () => {
  getPendingFailures.mockResolvedValue([])
  render(<SysproxyPrivilegeDialog />)
  onSubscribed?.()

  act(() =>
    requestService({
      reason: 'tunNeedsService',
      restore: { enable_tun_mode: true },
    }),
  )

  await screen.findByText('layout.components.sysproxyPrivilege.tunMessage')
  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(installService).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(patchVergeConfig).toHaveBeenCalledWith({ enable_tun_mode: true }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('shows what the user is doing now over what the table still holds', async () => {
  await showing('SYSPROXY_PRIVILEGE_REQUIRED')

  act(() => requestService({ reason: 'tunNeedsService' }))

  await screen.findByText('layout.components.sysproxyPrivilege.tunMessage')
})

it('changes nothing when a switch asked without saying what for', async () => {
  getPendingFailures.mockResolvedValue([])
  render(<SysproxyPrivilegeDialog />)
  onSubscribed?.()

  act(() => requestService({ reason: 'tunNeedsService' }))
  await screen.findByRole('dialog')
  clickPrimary('settings.sections.proxyControl.actions.installService')

  await waitFor(() => expect(restartCore).toHaveBeenCalledOnce())
  expect(patchVergeConfig).not.toHaveBeenCalled()
})
