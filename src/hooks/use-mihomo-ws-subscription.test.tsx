// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { SWRConfig } from 'swr'
import type { MihomoWebSocket } from 'tauri-plugin-mihomo-api'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'

import {
  cleanupSubscriptionKeys,
  swrCacheProvider,
} from '@/services/query-client'

class FakeMihomoWebSocket {
  private listeners = new Set<(msg: { type: 'Text'; data: string }) => void>()
  closed = false
  closeCount = 0
  private unsubscribes: Array<Mock<() => void>> = []

  addListener(
    cb: (msg: { type: 'Text'; data: string }) => void,
  ): Mock<() => void> {
    this.listeners.add(cb)
    const unsubscribe = () => {
      this.listeners.delete(cb)
    }
    const trackedUnsubscribe = vi.fn(unsubscribe)
    this.unsubscribes.push(trackedUnsubscribe)
    return trackedUnsubscribe
  }

  close = vi.fn(async () => {
    this.closed = true
    this.closeCount++
  })

  emit(data: string) {
    this.listeners.forEach((cb) => cb({ type: 'Text', data }))
  }

  getUnsubscribeCallCount() {
    return this.unsubscribes.reduce(
      (sum, unsubscribe) => sum + unsubscribe.mock.calls.length,
      0,
    )
  }
}

const createdSockets: FakeMihomoWebSocket[] = []

const mockConnect = vi.hoisted(() =>
  vi.fn(async () => {
    const ws = new FakeMihomoWebSocket()
    createdSockets.push(ws)
    return ws as unknown as MihomoWebSocket
  }),
)

vi.mock('tauri-plugin-mihomo-api', () => ({
  MihomoWebSocket: {
    connect_logs: () => mockConnect(),
    connect_traffic: () => mockConnect(),
    connect_memory: () => mockConnect(),
  },
}))

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

const prefix = 'testPrefix'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: swrCacheProvider }}>{children}</SWRConfig>
)

const makeHook = (storageKey: string, prefix: string) => () =>
  useMihomoWsSubscription<string>({
    storageKey,
    subscriptionPrefix: prefix,
    buildSubscriptKey: (date) => `test-${date}`,
    fallbackData: '',
    connect: () => mockConnect(),
    setupHandlers: ({ next }) => ({
      handleMessage: (data) => next(null, data),
    }),
  })

describe('useMihomoWsSubscription', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        for (const key of Object.keys(store)) {
          delete store[key]
        }
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length
      },
    })

    createdSockets.length = 0
    mockConnect.mockClear()
    localStorage.clear()
    cleanupSubscriptionKeys(prefix)
  })

  afterEach(() => {
    cleanupSubscriptionKeys(prefix)
    vi.unstubAllGlobals()
  })

  it('creates one socket on mount and closes it on unmount', async () => {
    const { unmount } = renderHook(makeHook('test_date_1', prefix), {
      wrapper,
    })

    await waitFor(() => expect(createdSockets.length).toBe(1))
    const ws = createdSockets[0]
    expect(ws.closed).toBe(false)

    unmount()
    await waitFor(() => expect(ws.closed).toBe(true))
  })

  it('shares one socket between concurrent subscribers', async () => {
    const { unmount: unmountA } = renderHook(makeHook('test_date_2', prefix), {
      wrapper,
    })
    const { unmount: unmountB } = renderHook(makeHook('test_date_2', prefix), {
      wrapper,
    })

    await waitFor(() => expect(createdSockets.length).toBe(1))
    const ws = createdSockets[0]

    unmountA()
    await waitFor(() => expect(ws.closed).toBe(false))

    unmountB()
    await waitFor(() => expect(ws.closed).toBe(true))
  })

  it('unsubscribes the socket listener before closing', async () => {
    const { unmount } = renderHook(makeHook('test_date_3', prefix), {
      wrapper,
    })

    await waitFor(() => expect(createdSockets.length).toBe(1))
    const ws = createdSockets[0]

    unmount()
    await waitFor(() => expect(ws.closed).toBe(true))
    expect(ws.getUnsubscribeCallCount()).toBeGreaterThanOrEqual(1)
  })

  it('does not create a new socket when one is already connecting', async () => {
    let resolveConnect: (ws: MihomoWebSocket) => void = () => {}
    mockConnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnect = (ws) => {
            createdSockets.push(ws as unknown as FakeMihomoWebSocket)
            resolve(ws)
          }
        }) as Promise<MihomoWebSocket>,
    )

    const { unmount } = renderHook(makeHook('test_date_4', prefix), {
      wrapper,
    })

    // Render a second subscriber with the same key while the first is still connecting.
    const { unmount: unmount2 } = renderHook(makeHook('test_date_4', prefix), {
      wrapper,
    })

    // Both subscribers should be waiting on the same in-flight connection.
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1))

    resolveConnect(new FakeMihomoWebSocket() as unknown as MihomoWebSocket)

    await waitFor(() => expect(createdSockets.length).toBe(1))

    unmount()
    unmount2()
  })

  it('closes the socket when the last subscriber unmounts during connection', async () => {
    let resolveConnect: (ws: MihomoWebSocket) => void = () => {}
    mockConnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnect = (ws) => {
            createdSockets.push(ws as unknown as FakeMihomoWebSocket)
            resolve(ws)
          }
        }) as Promise<MihomoWebSocket>,
    )

    const { unmount } = renderHook(makeHook('test_date_5', prefix), {
      wrapper,
    })

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1))
    unmount()

    const ws = new FakeMihomoWebSocket()
    createdSockets.push(ws)
    resolveConnect(ws as unknown as MihomoWebSocket)

    await waitFor(() =>
      expect((ws as unknown as FakeMihomoWebSocket).closed).toBe(true),
    )
  })
})
