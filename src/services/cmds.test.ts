import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commands } from './bindings'
import { createProfile, patchProfile, patchProfilesConfig } from './cmds'

vi.mock('./bindings', () => ({
  commands: {
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
