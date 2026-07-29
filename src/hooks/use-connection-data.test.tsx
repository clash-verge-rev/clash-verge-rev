// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { MihomoWebSocket } from 'tauri-plugin-mihomo-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeConnectionSocket {
  closed = false
  closeCount = 0
  unsubscribeCount = 0
  private listeners = new Set<(msg: { type: 'Text'; data: string }) => void>()

  addListener = vi.fn((cb: (msg: { type: 'Text'; data: string }) => void) => {
    this.listeners.add(cb)
    return () => {
      this.unsubscribeCount++
      this.listeners.delete(cb)
    }
  })

  close = vi.fn(async () => {
    this.closed = true
    this.closeCount++
  })

  emit(data: string) {
    this.listeners.forEach((cb) => cb({ type: 'Text', data }))
  }
}

const createdSockets: FakeConnectionSocket[] = []

const mockConnect = vi.hoisted(() =>
  vi.fn(async () => {
    const ws = new FakeConnectionSocket()
    createdSockets.push(ws)
    return ws as unknown as MihomoWebSocket
  }),
)

vi.mock('tauri-plugin-mihomo-api', () => ({
  MihomoWebSocket: {
    connect_connections: () => mockConnect(),
  },
}))

const loadModule = () => import('./use-connection-data')

describe('useConnectionData socket lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    createdSockets.length = 0
    mockConnect.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts one socket when a data subscriber mounts and closes it on unmount', async () => {
    const { useConnectionData } = await loadModule()
    const { unmount } = renderHook(() => useConnectionData())

    await waitFor(() => expect(createdSockets.length).toBe(1))
    const ws = createdSockets[0]
    expect(ws.closed).toBe(false)

    unmount()
    await waitFor(() => expect(ws.closed).toBe(true))
  })

  it('shares one socket between data and summary subscribers', async () => {
    const { useConnectionData, useConnectionSummaryData } = await loadModule()
    const { unmount: unmountData } = renderHook(() => useConnectionData())
    const { unmount: unmountSummary } = renderHook(() =>
      useConnectionSummaryData(),
    )

    await waitFor(() => expect(createdSockets.length).toBe(1))
    const ws = createdSockets[0]

    unmountData()
    await waitFor(() => expect(ws.closed).toBe(false))

    unmountSummary()
    await waitFor(() => expect(ws.closed).toBe(true))
  })

  it('unsubscribes the listener before closing the socket', async () => {
    const { useConnectionData } = await loadModule()
    const { unmount } = renderHook(() => useConnectionData())

    await waitFor(() => expect(createdSockets.length).toBe(1))
    const ws = createdSockets[0]
    expect(ws.unsubscribeCount).toBe(0)

    unmount()
    await waitFor(() => expect(ws.closed).toBe(true))
    expect(ws.unsubscribeCount).toBeGreaterThanOrEqual(1)
  })

  it('does not create a second socket when refresh is called while connecting', async () => {
    let resolveConnect: (ws: FakeConnectionSocket) => void = () => {}
    mockConnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnect = (ws: FakeConnectionSocket) => {
            createdSockets.push(ws)
            resolve(ws as unknown as MihomoWebSocket)
          }
        }) as Promise<MihomoWebSocket>,
    )

    const { useConnectionData } = await loadModule()
    const { result } = renderHook(() => useConnectionData())

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1))

    // A refresh while still connecting should not spin up a second socket.
    result.current.refreshGetClashConnection()
    expect(mockConnect).toHaveBeenCalledTimes(1)

    resolveConnect(new FakeConnectionSocket())
    await waitFor(() => expect(createdSockets.length).toBe(1))
  })

  it('reuses the in-flight connection when the last subscriber unmounts and remounts before it resolves', async () => {
    let resolveConnect: (ws: FakeConnectionSocket) => void = () => {}
    mockConnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnect = (ws) => {
            createdSockets.push(ws)
            resolve(ws as unknown as MihomoWebSocket)
          }
        }) as Promise<MihomoWebSocket>,
    )

    const { useConnectionData } = await loadModule()
    const { unmount } = renderHook(() => useConnectionData())

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1))
    unmount()

    const { unmount: unmount2 } = renderHook(() => useConnectionData())
    // Remounting while connecting must not trigger a second connection attempt.
    expect(mockConnect).toHaveBeenCalledTimes(1)

    const ws = new FakeConnectionSocket()
    resolveConnect(ws)
    await waitFor(() => expect(createdSockets.length).toBe(1))
    expect(ws.addListener).toHaveBeenCalled()

    unmount2()
    await waitFor(() => expect(ws.closed).toBe(true))
  })
})
