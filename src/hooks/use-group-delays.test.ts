import { useSyncExternalStore } from 'react'
import { expect, it, vi } from 'vitest'

import delayManager from '@/services/delay'
import type { ResolvedProxyMember } from '@/types/proxy-view'

import { useGroupDelays, useGroupsDelays } from './use-group-delays'

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: vi.fn((_subscribe, read) => read()),
}))

it('keeps the closed-menu snapshot unchanged when another member settles', () => {
  const member: ResolvedProxyMember = {
    kind: 'node',
    ref: { kind: 'node', name: 'current', recordId: 'current' },
    node: {
      recordId: 'current',
      name: 'current',
      type: 'Shadowsocks',
      source: { kind: 'core', proxyName: 'current' },
      history: [],
      udp: false,
      xudp: false,
      tfo: false,
      mptcp: false,
      smux: false,
    },
  }
  vi.spyOn(delayManager, 'getDelayFix').mockReturnValue(42)
  const snapshot = vi.spyOn(delayManager, 'groupDelays')
  snapshot.mockReturnValue({ of: () => 42 })
  useGroupDelays('group', member, false)
  const [, read] = vi.mocked(useSyncExternalStore).mock.calls.at(-1)!
  let previous = read()
  let changes = 0
  for (let i = 0; i < 120; i++) {
    snapshot.mockReturnValue({ of: () => 42 })
    const next = read()
    if (!Object.is(next, previous)) changes++
    previous = next
  }
  expect(changes).toBe(0)
})

it('subscribes once to the complete group name, including spaces', () => {
  vi.restoreAllMocks()
  const listen = vi.spyOn(delayManager, 'addGroupListener')
  const snapshot = useGroupsDelays(['Auto Select'])
  const [subscribe] = vi.mocked(useSyncExternalStore).mock.calls.at(-1)!
  const stop = subscribe(() => {})
  expect(
    listen.mock.calls.filter(([name]) => name === 'Auto Select'),
  ).toHaveLength(1)
  expect([...snapshot.keys()]).toEqual(['Auto Select'])
  stop()
  listen.mockRestore()
})
