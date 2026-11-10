import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const socket = vi.hoisted(() => ({
  addListener:
    vi.fn<
      (listener: (message: { type: string; data: string }) => void) => void
    >(),
  close: async () => {},
}))

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: vi.fn((_subscribe, getSnapshot) => getSnapshot()),
}))
vi.mock('tauri-plugin-mihomo-api', () => ({
  MihomoWebSocket: { connect_connections: async () => socket },
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('reuses unchanged snapshot and list references without notifying subscribers', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  vi.stubGlobal('window', globalThis)
  const { useConnectionData: readConnectionData } = await import(
    './use-connection-data'
  )
  readConnectionData()
  const [subscribe, read] = vi
    .mocked(
      useSyncExternalStore<
        ReturnType<typeof readConnectionData>['response']['data']
      >,
    )
    .mock.calls.at(-1)!
  const listener = vi.fn()
  const unsubscribe = subscribe(listener)
  await Promise.resolve()
  const onMessage = socket.addListener.mock.calls[0][0]
  const connections: IConnectionsItem[] = [
    {
      id: 'a',
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        host: 'example.com',
        sourceIP: '',
        sourcePort: '',
        destinationPort: '443',
      },
      chains: [],
      rule: '',
      rulePayload: '',
      start: '',
      upload: 0,
      download: 0,
    },
  ]
  const send = (uploadTotal = 0) => {
    vi.advanceTimersByTime(500)
    onMessage({
      type: 'Text',
      data: JSON.stringify({ connections, uploadTotal, downloadTotal: 0 }),
    })
    return read()
  }
  const first = send()
  expect(send()).toBe(first)
  expect(listener).toHaveBeenCalledTimes(1)
  const totalsOnly = send(100)
  expect(totalsOnly.activeConnections).toBe(first.activeConnections)
  expect(totalsOnly.closedConnections).toBe(first.closedConnections)
  unsubscribe()
})
