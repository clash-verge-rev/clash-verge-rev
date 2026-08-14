// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useSystemProxyState } from './use-system-proxy-state'

const patchVergeConfig = vi.hoisted(() => vi.fn())
const mutateVerge = vi.hoisted(() => vi.fn())
const getCacheData = vi.hoisted(() => vi.fn())
const revalidateQueries = vi.hoisted(() => vi.fn())

const CACHED: IVergeConfig = { enable_system_proxy: false } as IVergeConfig

vi.mock('@/hooks/use-verge', () => ({
  useVerge: () => ({ verge: CACHED, mutateVerge }),
}))
vi.mock('@/hooks/use-displayed-mixed-port', () => ({
  useDisplayedMixedPort: () => 7897,
}))
vi.mock('@/providers/app-data-context', () => ({
  useSystemData: () => ({ sysproxy: undefined }),
}))
vi.mock('@/services/cmds', () => ({
  getAutotemProxy: vi.fn(),
  getEmbeddedServerPort: vi.fn(),
  patchVergeConfig,
}))
vi.mock('tauri-plugin-mihomo-api', () => ({
  closeAllConnections: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/services/query-client', () => ({
  useQuery: () => ({ data: undefined }),
  getCacheData,
  revalidateQueries,
}))

beforeEach(() => {
  patchVergeConfig.mockReset()
  mutateVerge.mockReset()
  getCacheData.mockReset()
  getCacheData.mockReturnValue(CACHED)
  revalidateQueries.mockReset()
  revalidateQueries.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
})

const lastWrite = () => {
  const call = mutateVerge.mock.calls[mutateVerge.mock.calls.length - 1]?.[0]
  return typeof call === 'function' ? call(CACHED) : call
}

it('puts the cache back when the toggle fails', async () => {
  patchVergeConfig.mockRejectedValue({
    code: 'SYSPROXY_PRIVILEGE_REQUIRED',
    detail: 'refused',
  })
  const { result } = renderHook(() => useSystemProxyState())

  await act(async () => {
    await expect(result.current.toggleSystemProxy(true)).rejects.toBeTruthy()
  })

  expect(lastWrite()).toMatchObject({ enable_system_proxy: false })
})

it('falls back to what the last successful click reached, not to where the run began', async () => {
  patchVergeConfig.mockResolvedValueOnce(undefined).mockRejectedValueOnce({
    code: 'SYSPROXY_PRIVILEGE_REQUIRED',
    detail: 'refused',
  })
  getCacheData.mockReturnValue({ enable_system_proxy: true } as IVergeConfig)
  const { result } = renderHook(() => useSystemProxyState())

  await act(async () => {
    const inFlight = result.current.toggleSystemProxy(false)
    void result.current.toggleSystemProxy(true)
    await expect(inFlight).rejects.toBeTruthy()
  })

  expect(lastWrite()).toMatchObject({ enable_system_proxy: false })
})

it('lets a revalidation failure surface when the toggle itself worked', async () => {
  patchVergeConfig.mockResolvedValue(undefined)
  revalidateQueries.mockRejectedValue(new Error('network gone'))
  const { result } = renderHook(() => useSystemProxyState())

  await act(async () => {
    await expect(result.current.toggleSystemProxy(true)).rejects.toThrow(
      'network gone',
    )
  })
})

it('reports the failure the backend classified, not a revalidation that failed after it', async () => {
  patchVergeConfig.mockRejectedValue({
    code: 'SYSPROXY_PRIVILEGE_REQUIRED',
    detail: 'refused',
  })
  revalidateQueries.mockRejectedValue(new Error('network gone'))
  const { result } = renderHook(() => useSystemProxyState())

  await act(async () => {
    await expect(result.current.toggleSystemProxy(true)).rejects.toMatchObject({
      code: 'SYSPROXY_PRIVILEGE_REQUIRED',
    })
  })
})

it('revalidates the config it wrote to, not only the two proxy reads', async () => {
  patchVergeConfig.mockResolvedValue(undefined)
  const { result } = renderHook(() => useSystemProxyState())

  await act(async () => {
    await result.current.toggleSystemProxy(true)
  })

  expect(revalidateQueries).toHaveBeenCalledWith([
    ['getVergeConfig'],
    ['getSystemProxy'],
    ['getAutotemProxy'],
  ])
})

it('drops a click queued behind one that failed', async () => {
  let rejectFirst: ((reason: unknown) => void) | undefined
  patchVergeConfig.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectFirst = reject
      }),
  )
  const { result } = renderHook(() => useSystemProxyState())

  let inFlight: Promise<unknown> = Promise.resolve()
  await act(async () => {
    inFlight = result.current.toggleSystemProxy(true)
    void result.current.toggleSystemProxy(false)
    rejectFirst?.({ code: 'SYSPROXY_PRIVILEGE_REQUIRED', detail: 'refused' })
    await expect(inFlight).rejects.toBeTruthy()
  })

  expect(patchVergeConfig).toHaveBeenCalledTimes(1)
})
