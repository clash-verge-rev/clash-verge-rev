// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useForgetSelection, useRecordSelection } from './use-record-selection'

const recordSelectedNode = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const forgetSelectedNode = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@/services/cmds', () => ({ forgetSelectedNode, recordSelectedNode }))

const record = (groupName: string, proxyName: string) => {
  const { result } = renderHook(() => useRecordSelection())
  result.current(groupName, proxyName)
}

beforeEach(() => {
  recordSelectedNode.mockClear()
  forgetSelectedNode.mockClear()
})

describe('useForgetSelection', () => {
  it('sends only the group name', () => {
    const { result } = renderHook(() => useForgetSelection())

    result.current('Proxy')

    expect(forgetSelectedNode).toHaveBeenCalledWith('Proxy')
  })

  it('resolves after the clear request finishes', async () => {
    let resolveForget!: () => void
    forgetSelectedNode.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveForget = resolve)),
    )
    const { result } = renderHook(() => useForgetSelection())

    const forget = result.current('Proxy')
    let settled = false
    forget.then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)

    resolveForget()
    await forget
    expect(settled).toBe(true)
  })

  it('reports a failed clear without throwing at the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    forgetSelectedNode.mockRejectedValueOnce(new Error('no profile'))
    const { result } = renderHook(() => useForgetSelection())

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
    // Pair-wise writes let the backend merge concurrent choices against fresh state.
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
    // Persistence failure cannot roll back a core selection that already succeeded.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    recordSelectedNode.mockRejectedValueOnce(new Error('no profile'))

    expect(() => record('Proxy', 'Node A')).not.toThrow()

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
  })
})
