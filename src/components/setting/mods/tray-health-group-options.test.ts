import { describe, expect, it } from 'vitest'

import type { ProxyGroupView, ProxyViewV1 } from '@/types/proxy-view'

import {
  getTrayHealthGroupOptions,
  normalizeTrayHealthGroup,
} from './tray-health-group-options'

const group = (name: string, extra: Partial<ProxyGroupView> = {}) =>
  ({
    name,
    type: 'Selector',
    history: [],
    members: [],
    ...extra,
  }) as ProxyGroupView

const view = (groups: ProxyGroupView[], global = group('GLOBAL')) =>
  ({ global, groups }) as unknown as ProxyViewV1

describe('getTrayHealthGroupOptions', () => {
  it('lists visible groups without inferring a selection or offering GLOBAL', () => {
    const options = getTrayHealthGroupOptions(
      view([
        group('Proxy'),
        group('Auto', { type: 'URLTest' }),
        group('Internal', { hidden: true }),
      ]),
      null,
    )

    expect(options).toEqual([
      { name: 'Proxy', unavailable: false },
      { name: 'Auto', unavailable: false },
    ])
  })

  it('keeps an explicitly selected hidden group selectable', () => {
    expect(
      getTrayHealthGroupOptions(
        view([group('Internal', { hidden: true })]),
        'Internal',
      ),
    ).toEqual([{ name: 'Internal', unavailable: false }])
  })

  it('keeps a selected group that left the profile and marks it unavailable', () => {
    expect(getTrayHealthGroupOptions(view([group('Proxy')]), 'Old')).toEqual([
      { name: 'Proxy', unavailable: false },
      { name: 'Old', unavailable: true },
    ])
  })

  it('does not flag the selection while the core is stopped or restarting', () => {
    expect(getTrayHealthGroupOptions(undefined, 'Proxy')).toEqual([
      { name: 'Proxy', unavailable: false },
    ])
  })

  it('follows the latest selection after rapid changes', () => {
    const current = view([group('A'), group('B')])
    const options = ['A', 'B', 'Gone', 'A'].map((selected) =>
      getTrayHealthGroupOptions(current, selected),
    )

    expect(options[2]).toContainEqual({ name: 'Gone', unavailable: true })
    expect(options[3]).toEqual([
      { name: 'A', unavailable: false },
      { name: 'B', unavailable: false },
    ])
  })
})

describe('normalizeTrayHealthGroup', () => {
  it.each([undefined, null, ''])(
    'treats %j from persisted config as no group',
    (value) => {
      expect(normalizeTrayHealthGroup(value)).toBeNull()
    },
  )

  it('keeps group names', () => {
    expect(normalizeTrayHealthGroup('Proxy')).toBe('Proxy')
  })
})
