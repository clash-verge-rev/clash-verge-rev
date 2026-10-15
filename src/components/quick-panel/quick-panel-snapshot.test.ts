import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getProxyView, getRuntimeState, getSystemProxy } from '@/services/cmds'

import { readQuickPanelSnapshot } from './quick-panel-snapshot'

vi.mock('@/services/cmds', () => ({
  getVergeConfig: vi.fn(async () => ({
    language: 'zh',
    proxy_host: '127.0.0.1',
  })),
  getProfiles: vi.fn(async () => ({ current: 'subscription', items: [] })),
  getClashMode: vi.fn(async () => 'rule'),
  getSystemProxy: vi.fn(async () => ({
    enable: false,
    server: '',
    bypass: '',
  })),
  getAutoProxy: vi.fn(async () => ({ enable: false, url: '' })),
  getClashInfo: vi.fn(async () => ({ mixed_port: 7897 })),
  getEmbeddedServerPort: vi.fn(async () => 3333),
  getRuntimeState: vi.fn(),
  getProxyView: vi.fn(),
}))

const runtime = {
  mode: 'Sidecar' as const,
  service: 'unavailable' as const,
  serviceUnavailableReason: null,
  pendingAction: null,
  sidecarAllowed: true,
  isAdmin: false,
  opInFlight: false,
  serviceUsable: false,
  tunCapable: false,
  serviceNeedsAttention: false,
}
const view = {
  schemaVersion: 1 as const,
  orderSource: 'runtime' as const,
  providerState: 'ready' as const,
  groups: [],
  records: {},
  providers: [],
  standalone: [],
  global: null,
  direct: 'DIRECT',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntimeState).mockResolvedValue(runtime)
  vi.mocked(getProxyView).mockResolvedValue(view)
  vi.mocked(getSystemProxy).mockResolvedValue({
    enable: false,
    server: '',
    bypass: '',
  })
})

describe('quick panel disconnected state', () => {
  it('keeps local configuration when the core is stopped without requesting proxies', async () => {
    vi.mocked(getRuntimeState).mockResolvedValue({
      ...runtime,
      mode: 'NotRunning',
    })
    const snapshot = await readQuickPanelSnapshot()
    expect(snapshot.connection).toBe('offline')
    expect(snapshot.profiles.current).toBe('subscription')
    expect(snapshot.mode).toBe('rule')
    expect(snapshot.view).toBeNull()
    expect(getProxyView).not.toHaveBeenCalled()
  })

  it('keeps configuration and actual proxy state when the proxy request fails', async () => {
    vi.mocked(getProxyView).mockRejectedValue(
      new Error('error sending request for url (http://localhost/proxies)'),
    )
    vi.mocked(getSystemProxy).mockResolvedValue({
      enable: true,
      server: '127.0.0.1:7897',
      bypass: '',
    })
    const snapshot = await readQuickPanelSnapshot()
    expect(snapshot.connection).toBe('unavailable')
    expect(snapshot.profiles.current).toBe('subscription')
    expect(snapshot.systemProxy).toBe(true)
    expect(snapshot.view).toBeNull()
  })

  it('keeps a running core usable when system proxy is off', async () => {
    const snapshot = await readQuickPanelSnapshot()
    expect(snapshot.connection).toBe('ready')
    expect(snapshot.systemProxy).toBe(false)
    expect(snapshot.view).toEqual(view)
  })

  it('recovers on the next refresh after a failed proxy request', async () => {
    vi.mocked(getProxyView).mockRejectedValueOnce(
      new Error('Connection refused'),
    )
    expect((await readQuickPanelSnapshot()).connection).toBe('unavailable')
    expect((await readQuickPanelSnapshot()).connection).toBe('ready')
  })
})
