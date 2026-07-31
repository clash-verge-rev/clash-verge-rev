import { invoke } from '@tauri-apps/api/core'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

import { syncTrayProxySelection } from './cmds'

beforeEach(() => {
  vi.mocked(invoke).mockClear()
})

test('syncs only the proxy item selected by the frontend', async () => {
  await syncTrayProxySelection(
    'group_with_underscores',
    'node_with_underscores',
  )

  expect(invoke).toHaveBeenCalledWith('sync_tray_proxy_selection', {
    groupName: 'group_with_underscores',
    proxyName: 'node_with_underscores',
  })
})
