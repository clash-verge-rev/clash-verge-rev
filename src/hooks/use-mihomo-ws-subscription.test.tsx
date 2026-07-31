// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { MihomoWebSocket } from 'tauri-plugin-mihomo-api'
import { describe, expect, it, vi } from 'vitest'

vi.mock('foxact/use-local-storage', () => ({
  useLocalStorage: (_key: string, initialValue: number) => [
    initialValue,
    vi.fn(),
  ],
}))

vi.mock('@/services/query-client', () => ({
  getCacheData: vi.fn(),
  removeCacheData: vi.fn(),
  setCacheData: vi.fn(),
  useQuery: vi.fn(() => ({ data: [] })),
}))

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

const createSocket = () => {
  const close = vi.fn(async () => {})
  const addListener = vi.fn()

  return {
    socket: { close, addListener } as unknown as MihomoWebSocket,
    close,
    addListener,
  }
}

const renderSubscription = (
  connect: () => Promise<MihomoWebSocket>,
  onConnected?: (ws: MihomoWebSocket) => Promise<void> | void,
) => {
  const subscriptionKey = crypto.randomUUID()

  return renderHook(() =>
    useMihomoWsSubscription<string[]>({
      storageKey: `ws-cleanup-storage-${subscriptionKey}`,
      buildSubscriptKey: () => `ws-cleanup-${subscriptionKey}`,
      fallbackData: [],
      connect,
      setupHandlers: () => ({
        handleMessage: () => {},
        onConnected,
      }),
    }),
  )
}

describe('useMihomoWsSubscription connection setup', () => {
  it('closes the candidate socket when onConnected fails', async () => {
    const { socket, close, addListener } = createSocket()
    const connect = vi.fn(async () => socket)
    const onConnected = vi.fn(async () => {
      throw new Error('initial state unavailable')
    })

    const { unmount } = renderSubscription(connect, onConnected)

    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(addListener).not.toHaveBeenCalled()
    unmount()
  })

  it('closes the candidate socket when listener setup fails', async () => {
    const { socket, close, addListener } = createSocket()
    addListener.mockImplementationOnce(() => {
      throw new Error('listener setup failed')
    })
    const connect = vi.fn(async () => socket)

    const { unmount } = renderSubscription(connect)

    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    unmount()
  })
})
