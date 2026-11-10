import { expect, it, vi } from 'vitest'

import type { DelaySnapshot } from '@/services/delay'
import { resolveMember, type ProxyViewV1 } from '@/types/proxy-view'

import { filterSort } from './use-filter-sort'
import { useRenderList as readRenderList } from './use-render-list'

const hooks = vi.hoisted(() => {
  const slots: { value: unknown; deps?: unknown[] }[] = []
  let cursor = 0
  return {
    reset: () => {
      cursor = 0
    },
    memo: (factory: () => unknown, deps: unknown[]) => {
      const index = cursor++
      const old = slots[index]
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps?.[i]))) {
        slots[index] = { value: factory(), deps }
      }
      return slots[index].value
    },
    ref: (current: unknown) => {
      const index = cursor++
      slots[index] ??= { value: { current } }
      return slots[index].value
    },
  }
})
const state = vi.hoisted(() => ({
  view: null as ProxyViewV1 | null,
  delays: new Map<string, DelaySnapshot>(),
}))

vi.mock('react', () => ({
  useMemo: hooks.memo,
  useRef: hooks.ref,
  useEffect: () => {},
}))
vi.mock('@/hooks/use-profiles', () => ({}))
vi.mock('@/hooks/use-clash', () => ({
  useRuntimeConfig: () => ({ data: null }),
}))
vi.mock('@/hooks/use-verge', () => ({
  useVerge: () => ({ verge: { proxy_layout_column: 1 } }),
}))
vi.mock('@/providers/app-data-context', () => ({
  useProxiesData: () => ({ proxyView: state.view }),
  useAppRefreshers: () => ({ refreshProxy: () => {} }),
}))
vi.mock('@/hooks/use-group-delays', () => ({
  useGroupsDelays: (names: string[]) =>
    new Map(names.map((name) => [name, state.delays.get(name)])),
}))
vi.mock('./use-window-width', () => ({
  useWindowWidth: () => ({ width: 800 }),
}))
vi.mock('./use-head-state', async (original) => {
  const actual = await original<typeof import('./use-head-state')>()
  const heads = {
    plain: { ...actual.DEFAULT_STATE, open: true },
    sorted: { ...actual.DEFAULT_STATE, open: true, sortType: 1 },
  }
  return { ...actual, useHeadStateNew: () => [heads, () => {}] }
})
vi.mock('./use-filter-sort', async (original) => {
  const actual = await original<typeof import('./use-filter-sort')>()
  return { ...actual, filterSort: vi.fn(actual.filterSort) }
})
vi.mock('@/types/proxy-view', async (original) => {
  const actual = await original<typeof import('@/types/proxy-view')>()
  return { ...actual, resolveMember: vi.fn(actual.resolveMember) }
})

it('skips delay-independent projections and reuses members for delay sorting', () => {
  const group = (name: string) => ({
    name,
    type: 'Selector',
    history: [],
    udp: false,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
    members: Array.from({ length: 500 }, (_, i) => ({
      kind: 'unresolved' as const,
      name: `${i}`,
      reason: 'missing' as const,
    })),
  })
  state.view = {
    schemaVersion: 1,
    orderSource: 'runtime',
    providerState: 'ready',
    global: null,
    direct: null,
    groups: [group('plain'), group('sorted')],
    records: {},
    standalone: [],
    providers: [],
  }
  const render = () => {
    hooks.reset()
    return readRenderList('rule')
  }
  state.delays.set('plain', { of: () => 42 })
  state.delays.set('sorted', { of: () => 42 })
  const initial = render().renderList
  vi.mocked(filterSort).mockClear()
  vi.mocked(resolveMember).mockClear()
  state.delays.set('plain', { of: () => 43 })
  const flatMap = vi.spyOn(Array.prototype, 'flatMap')
  const flat = vi.spyOn(Array.prototype, 'flat')
  const unrelated = render().renderList
  expect(filterSort).toHaveBeenCalledTimes(0)
  expect(flatMap.mock.calls.length + flat.mock.calls.length).toBe(0)
  expect(unrelated.filter((item, i) => item !== initial[i])).toHaveLength(0)
  state.delays.set('sorted', { of: () => 43 })
  const settled = render().renderList
  expect(filterSort).toHaveBeenCalledTimes(1)
  expect(resolveMember).toHaveBeenCalledTimes(0)
  expect(settled.filter((item, i) => item !== initial[i])).toHaveLength(0)
  flatMap.mockRestore()
  flat.mockRestore()
})
