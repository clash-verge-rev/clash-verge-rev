// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useClearSelection, useRecordSelection } from './use-record-selection'

const recordSelectedNode = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const clearSelectedNode = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@/services/cmds', () => ({ clearSelectedNode, recordSelectedNode }))

const record = (groupName: string, proxyName: string) => {
  const { result } = renderHook(() => useRecordSelection())
  result.current(groupName, proxyName)
}

beforeEach(() => {
  recordSelectedNode.mockClear()
  clearSelectedNode.mockClear()
})

describe('useClearSelection', () => {
  it('sends only the group name', () => {
    const { result } = renderHook(() => useClearSelection())

    result.current('Proxy')

    expect(clearSelectedNode).toHaveBeenCalledWith('Proxy')
  })

  it('reports a failed clear without throwing at the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    clearSelectedNode.mockRejectedValueOnce(new Error('no profile'))
    const { result } = renderHook(() => useClearSelection())

    expect(() => result.current('Proxy')).not.toThrow()

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
    consoleError.mockRestore()
  })
})

describe('useRecordSelection', () => {
  it('sends only the group and the node', () => {
    record('Proxy', 'Node A')

    expect(recordSelectedNode).toHaveBeenCalledWith('Proxy', 'Node A')
  })

  it('does not derive anything from a rendered selection list', () => {
    // The regression this pins. It used to build the whole list from the profile it had
    // rendered, so two selections made before that list refreshed were both derived from the
    // same stale snapshot and the later one dropped the earlier group. Since a core start
    // re-applies whatever the profile holds, the dropped choice came back on the next restart.
    // Each call now carries one group, and the backend merges against the current profile.
    record('Proxy', 'Node A')
    record('Fallback', 'Node C')

    expect(recordSelectedNode).toHaveBeenNthCalledWith(1, 'Proxy', 'Node A')
    expect(recordSelectedNode).toHaveBeenNthCalledWith(2, 'Fallback', 'Node C')
  })

  it('is stable across renders, so callers may hold it in a dependency array', () => {
    const { result, rerender } = renderHook(() => useRecordSelection())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('reports a failed write without throwing at the caller', async () => {
    // Recording runs after the core has already been switched; failing the switch over it would
    // be wrong, so the caller is never made to handle it.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    recordSelectedNode.mockRejectedValueOnce(new Error('no profile'))

    expect(() => record('Proxy', 'Node A')).not.toThrow()

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
  })
})
