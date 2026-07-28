// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecordSelection } from './use-record-selection'

const patchCurrent = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const profileItem = vi.hoisted(() => ({
  value: undefined as
    | { selected?: Array<{ name: string; now: string }> }
    | undefined,
}))

vi.mock('@/hooks/use-profiles', () => ({
  useProfiles: () => ({ current: profileItem.value, patchCurrent }),
}))

const record = (groupName: string, proxyName: string) => {
  const { result } = renderHook(() => useRecordSelection())
  result.current(groupName, proxyName)
}

beforeEach(() => {
  patchCurrent.mockClear()
  profileItem.value = { selected: [] }
})

describe('useRecordSelection', () => {
  it('records a group that had no selection yet', () => {
    record('Proxy', 'Node A')

    expect(patchCurrent).toHaveBeenCalledWith({
      selected: [{ name: 'Proxy', now: 'Node A' }],
    })
  })

  it('replaces a group in place rather than appending a second entry', () => {
    // Two entries for one group would let the stale one win on the next start, depending on
    // which the reconciler reached first.
    profileItem.value = { selected: [{ name: 'Proxy', now: 'Node A' }] }

    record('Proxy', 'Node B')

    expect(patchCurrent).toHaveBeenCalledWith({
      selected: [{ name: 'Proxy', now: 'Node B' }],
    })
  })

  it('leaves other groups alone', () => {
    profileItem.value = {
      selected: [
        { name: 'Proxy', now: 'Node A' },
        { name: 'Fallback', now: 'Node C' },
      ],
    }

    record('Proxy', 'Node B')

    expect(patchCurrent).toHaveBeenCalledWith({
      selected: [
        { name: 'Proxy', now: 'Node B' },
        { name: 'Fallback', now: 'Node C' },
      ],
    })
  })

  it('does not mutate the profile it was handed', () => {
    // `current` comes from the profiles cache; editing it in place would make the next render
    // compare a value against itself and skip the write.
    const selected = [{ name: 'Proxy', now: 'Node A' }]
    profileItem.value = { selected }

    record('Proxy', 'Node B')

    expect(selected).toEqual([{ name: 'Proxy', now: 'Node A' }])
  })

  it('records nothing when no profile is active', () => {
    profileItem.value = undefined

    record('Proxy', 'Node A')

    expect(patchCurrent).not.toHaveBeenCalled()
  })
})
