import { describe, expect, it } from 'vitest'

import type { ProxyViewV1_Serialize } from '@/services/bindings'

import { buildQuickGroups, favoriteScope } from './quick-panel-data'

const capabilities = {
  udp: true,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
}
const view: ProxyViewV1_Serialize = {
  schemaVersion: 1,
  orderSource: 'runtime',
  providerState: 'ready',
  global: null,
  direct: 'DIRECT',
  standalone: [],
  providers: [],
  groups: [
    {
      ...capabilities,
      name: 'Proxy',
      type: 'Selector',
      now: 'Hong Kong',
      history: [],
      extra: {},
      members: [{ kind: 'node', name: 'Hong Kong', recordId: 'record-1' }],
    },
  ],
  records: {
    'record-1': {
      ...capabilities,
      recordId: 'record-1',
      name: 'Hong Kong',
      type: 'Shadowsocks',
      history: [{ time: '2026-10-13', delay: 38 }],
      extra: {},
      source: {
        kind: 'provider',
        providerName: 'Provider A',
        proxyName: 'Hong Kong',
      },
    },
  },
}

describe('quick panel favorite identity', () => {
  it('keeps a missing favorite unavailable instead of choosing a same-name node from another provider', () => {
    const original = buildQuickGroups(view, 'subscription-a', {})[0].nodes[0]
    const changed: ProxyViewV1_Serialize = {
      ...view,
      records: {
        'record-1': {
          ...view.records['record-1'],
          source: {
            kind: 'provider',
            providerName: 'Provider B',
            proxyName: 'Hong Kong',
          },
        },
      },
    }
    const group = buildQuickGroups(changed, 'subscription-a', {
      [favoriteScope('subscription-a', 'Proxy')]: [original],
    })[0]
    expect(group.favorites).toEqual([original.id])
    expect(group.nodes.find((node) => node.id === original.id)?.available).toBe(
      false,
    )
    expect(group.selected).not.toBe(original.id)
  })

  it('does not reuse favorites across subscriptions with the same group name', () => {
    const favorite = { id: 'unavailable-id', name: 'Old node', region: 'NODE' }
    const group = buildQuickGroups(view, 'subscription-b', {
      [favoriteScope('subscription-a', 'Proxy')]: [favorite],
    })[0]
    expect(group.favorites).not.toContain(favorite.id)
    expect(group.nodes.some((node) => node.name === favorite.name)).toBe(false)
  })

  it('preserves an explicitly empty favorite selection', () => {
    const group = buildQuickGroups(view, 'subscription-a', {
      [favoriteScope('subscription-a', 'Proxy')]: [],
    })[0]
    expect(group.favorites).toEqual([])
    expect(group.selected).toBe(group.nodes[0].id)
  })
})
