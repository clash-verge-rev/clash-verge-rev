import { fetch } from '@tauri-apps/plugin-http'
import { getBaseConfig } from 'tauri-plugin-mihomo-api'
import { expect, test, vi } from 'vitest'

import { getIpInfo } from './api'

vi.mock('@tauri-apps/api/app', () => ({
  getName: vi.fn().mockResolvedValue('clash-verge'),
  getVersion: vi.fn().mockResolvedValue('2.5.9'),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('tauri-plugin-mihomo-api', () => ({ getBaseConfig: vi.fn() }))
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }))

test('IP refreshes use the live mixed port without relying on system proxy discovery', async () => {
  vi.mocked(getBaseConfig)
    .mockResolvedValueOnce({ mixedPort: 7890 } as Awaited<
      ReturnType<typeof getBaseConfig>
    >)
    .mockResolvedValueOnce({ mixedPort: 17900 } as Awaited<
      ReturnType<typeof getBaseConfig>
    >)
  vi.mocked(fetch).mockImplementation(
    async () => new Response(JSON.stringify({ ip: '203.0.113.1' })),
  )

  await getIpInfo()
  expect(fetch).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ proxy: { all: 'http://127.0.0.1:7890' } }),
  )

  await getIpInfo()
  expect(fetch).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ proxy: { all: 'http://127.0.0.1:17900' } }),
  )
})
