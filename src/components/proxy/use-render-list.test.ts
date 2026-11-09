import { expect, it, vi } from 'vitest'

import { hasRenderableItems, useRenderList } from './use-render-list'

// mihomo skips its built-in GLOBAL when a profile defines one, and the backend
// always moves GLOBAL out of `groups`, so this profile has no other group.
const proxyView = vi.hoisted(() => {
  const capabilities = {
    udp: false,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
  }
  const node = (name: string) => ({
    recordId: name,
    name,
    type: 'Shadowsocks',
    history: [],
    source: { kind: 'core' as const, proxyName: name },
    ...capabilities,
  })
  return {
    schemaVersion: 1,
    orderSource: 'runtime' as const,
    providerState: 'ready' as const,
    global: {
      name: 'GLOBAL',
      type: 'Selector',
      now: 'node-a',
      history: [],
      members: [
        { kind: 'node' as const, name: 'node-a', recordId: 'node-a' },
        { kind: 'node' as const, name: 'node-b', recordId: 'node-b' },
      ],
      ...capabilities,
    },
    direct: null,
    groups: [],
    records: { 'node-a': node('node-a'), 'node-b': node('node-b') },
    standalone: [],
    providers: [],
  }
})

vi.mock('react', () => ({
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
}))
vi.mock('@/providers/app-data-context', () => ({
  useAppRefreshers: () => ({ refreshProxy: vi.fn() }),
  useProxiesData: () => ({ proxyView }),
}))
vi.mock('@/hooks/use-clash', () => ({
  useRuntimeConfig: () => ({ data: null }),
}))
vi.mock('@/hooks/use-group-delays', () => ({
  useGroupsDelays: () => new Map(),
}))
vi.mock('@/hooks/use-verge', () => ({ useVerge: () => ({ verge: {} }) }))
vi.mock('./use-head-state', () => ({
  DEFAULT_STATE: {
    showType: true,
    sortType: 0,
    filterText: '',
    textState: null,
    testUrl: '',
  },
  useHeadStateNew: () => [{}, vi.fn()],
}))
vi.mock('./use-window-width', () => ({
  useWindowWidth: () => ({ width: 500 }),
}))

it('lists a profile-defined GLOBAL in rule mode when it is the only group', () => {
  const { renderList } = useRenderList('rule')

  expect(hasRenderableItems(renderList)).toBe(true)
  expect(renderList.map(({ key }) => key)).toEqual([
    'head-GLOBAL',
    'GLOBAL:0:node-a',
    'GLOBAL:1:node-b',
  ])
})
