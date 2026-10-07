import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commands } from './bindings'
import {
  createProfile,
  patchProfile,
  patchProfilesConfig,
  updateProxyChainConfigInRuntime,
} from './cmds'
import { mutate } from './mutate'

vi.mock('./bindings', () => ({
  commands: {
    updateProxyChainConfigInRuntime: vi.fn(),
    createProfile: vi.fn(),
    patchProfile: vi.fn(),
    patchProfilesConfig: vi.fn(),
  },
}))

const wirePayload = (value: unknown) => JSON.parse(JSON.stringify(value))

beforeEach(() => vi.clearAllMocks())

describe('profile IPC projections', () => {
  it('sends only current for profile selection even with a full snapshot', async () => {
    const snapshot = { current: 'profile', items: [{ uid: 'profile' }] }
    await patchProfilesConfig(snapshot)
    expect(commands.patchProfilesConfig).toHaveBeenCalledWith({
      current: 'profile',
    })
  })

  it('strips profile output fields while retaining explicit selections and options', async () => {
    const selected = [{ name: 'group', now: 'node' }]
    const option = {
      script: 'script',
      merge: 'merge',
      rules: 'rules',
      proxies: 'proxies',
      groups: 'groups',
    }
    const profile = {
      uid: 'profile',
      home: 'https://example.com',
      file_data: 'unused',
      name: 'renamed',
      selected,
      option,
    }
    await patchProfile('profile', profile)
    expect(
      wirePayload(vi.mocked(commands.patchProfile).mock.calls[0][1]),
    ).toEqual({ name: 'renamed', selected, option })
  })

  it('omits ignored creation fields and a local profile URL', async () => {
    const profile = {
      type: 'local',
      name: 'local',
      url: '',
      uid: 'old',
      selected: [{ name: 'group', now: 'node' }],
    }
    await createProfile(profile, 'content')
    const [payload, content] = vi.mocked(commands.createProfile).mock.calls[0]
    expect(wirePayload(payload)).toEqual({ type: 'local', name: 'local' })
    expect(content).toBe('content')
  })
})

vi.mock('@/services/notice-service', () => ({
  showNotice: { error: vi.fn(), success: vi.fn() },
}))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

describe('proxy chain runtime confirmation', () => {
  it('does not continue after a busy runtime update', async () => {
    vi.mocked(commands.updateProxyChainConfigInRuntime).mockResolvedValue({
      status: 'busy',
    })
    const onFulfilled = vi.fn()
    const result = await mutate(() => updateProxyChainConfigInRuntime(null), {
      id: 'update-proxy-chain-runtime',
      onFulfilled,
    })
    expect(result.ok).toBe(false)
    expect(onFulfilled).not.toHaveBeenCalled()
  })

  it('rejects failed validation without a success continuation', async () => {
    vi.mocked(commands.updateProxyChainConfigInRuntime).mockResolvedValue({
      status: 'invalid',
      kind: 'yamlSyntax',
      message: 'invalid proxy chain',
    })
    const onFulfilled = vi.fn()
    await expect(
      mutate(() => updateProxyChainConfigInRuntime(['node']), {
        id: 'update-proxy-chain-runtime',
        onFulfilled,
      }),
    ).rejects.toThrow('invalid proxy chain')
    expect(onFulfilled).not.toHaveBeenCalled()
  })
})
