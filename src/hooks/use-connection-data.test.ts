import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  vi.stubGlobal('window', globalThis)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const connection = (id: string, upload = 0): IConnectionsItem => ({
  id,
  metadata: {
    network: 'tcp',
    type: 'HTTP',
    host: `${id}.example`,
    sourceIP: '127.0.0.1',
    sourcePort: '1234',
    destinationPort: '443',
  },
  chains: ['DIRECT'],
  rule: 'Match',
  rulePayload: '',
  start: '2026-01-01T00:00:00Z',
  upload,
  download: 0,
})

const monitor = async () => {
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
  const send = (connections: IConnectionsItem[], uploadTotal = 0) => {
    vi.advanceTimersByTime(500)
    onMessage({
      type: 'Text',
      data: JSON.stringify({ connections, uploadTotal, downloadTotal: 0 }),
    })
    return read()
  }
  return { send, listener, unsubscribe }
}

it('reuses unchanged snapshots and lists without notifying, including totals-only updates', async () => {
  const { send, listener, unsubscribe } = await monitor()
  const first = send([connection('a'), connection('b')])
  Object.freeze(first.activeConnections)
  first.activeConnections.forEach(Object.freeze)
  expect(send([connection('a'), connection('b')])).toBe(first)
  expect(listener).toHaveBeenCalledTimes(1)

  const totalsOnly = send([connection('a'), connection('b')], 100)
  expect(totalsOnly).not.toBe(first)
  expect(totalsOnly.activeConnections).toBe(first.activeConnections)
  expect(totalsOnly.closedConnections).toBe(first.closedConnections)
  expect(totalsOnly.uploadTotal).toBe(100)
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
})

it('updates traffic, decays speed to zero, and preserves immutable history through reorder and removal', async () => {
  const { send, unsubscribe } = await monitor()
  const first = send([connection('a'), connection('b')])
  const changed = send([connection('a', 50), connection('b')])
  expect(changed.activeConnections[0].curUpload).toBe(50)
  expect(changed.activeConnections[0].metadata).toBe(
    first.activeConnections[0].metadata,
  )
  expect(changed.activeConnections[0].chains).toBe(
    first.activeConnections[0].chains,
  )
  expect(changed.activeConnections[1]).toBe(first.activeConnections[1])
  expect(first.activeConnections[0].upload).toBe(0)

  const idle = send([connection('a', 50), connection('b')])
  expect(idle.activeConnections[0].curUpload).toBe(0)
  expect(send([connection('a', 50), connection('b')])).toBe(idle)
  const reordered = send([connection('b'), connection('a', 50)])
  expect(reordered.activeConnections).toEqual([
    idle.activeConnections[1],
    idle.activeConnections[0],
  ])
  expect(reordered.closedConnections).toBe(idle.closedConnections)
  const removed = send([connection('b'), connection('c')])
  expect(removed.closedConnections).toEqual([idle.activeConnections[0]])
  expect(removed.closedConnections[0]).toBe(idle.activeConnections[0])
  const next = send([connection('b', 10), connection('c')])
  expect(next.closedConnections).toBe(removed.closedConnections)
  unsubscribe()
})

it('evicts the oldest closed entries at 500 without mutating retained history', async () => {
  const { send, unsubscribe } = await monitor()
  send(Array.from({ length: 502 }, (_, i) => connection(`${i}`)))
  const closed = send([])
  expect(closed.closedConnections).toHaveLength(500)
  expect(closed.closedConnections[0].id).toBe('2')
  send([connection('new-a'), connection('new-b')])
  const evicted = send([])
  expect(evicted.closedConnections).toHaveLength(500)
  expect(evicted.closedConnections[0].id).toBe('4')
  expect(evicted.closedConnections.at(-1)?.id).toBe('new-b')
  expect(closed.closedConnections[0].id).toBe('2')

  unsubscribe()
})
