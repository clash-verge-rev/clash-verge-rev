import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

import { useIconCache } from '@/hooks/use-icon-cache'
import { useVerge } from '@/hooks/use-verge'
import { useThemeMode } from '@/services/states'
import type { ProxyGroupView } from '@/types/proxy-view'

import { ProxyRender } from './proxy-render'
import { DEFAULT_STATE } from './use-head-state'

vi.mock('@/hooks/use-verge', () => ({
  useVerge: vi.fn(() => ({ verge: {} })),
}))
vi.mock('@/hooks/use-icon-cache', () => ({
  useIconCache: vi.fn(() => ''),
}))
vi.mock('@/services/states', () => ({
  useThemeMode: vi.fn(() => 'light'),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('./proxy-item', () => ({ ProxyItem: () => null }))
vi.mock('./proxy-group-tools', () => ({ ProxyGroupTools: () => null }))
vi.mock('./proxy-group-header-block', () => ({ ProxyGroupHeaderBlock: 'div' }))

it('keeps header-only consumers off 500 mounted member rows', () => {
  const group: ProxyGroupView = {
    name: 'group',
    type: 'Selector',
    history: [],
    members: [],
    udp: false,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
  }
  const noop = () => {}
  for (let i = 0; i <= 500; i++) {
    renderToStaticMarkup(
      createElement(ProxyRender, {
        item: {
          type: i === 0 ? 0 : 2,
          key: `${i}`,
          group,
          headState: DEFAULT_STATE,
          member: {
            memberIndex: i,
            member: {
              kind: 'unresolved',
              ref: { kind: 'unresolved', name: `${i}`, reason: 'missing' },
            },
          },
        },
        onLocation: noop,
        onCheckAll: noop,
        onHeadState: noop,
        onChangeProxy: noop,
      }),
    )
  }
  expect(useVerge).toHaveBeenCalledTimes(1)
  expect(useThemeMode).toHaveBeenCalledTimes(1)
  expect(useIconCache).toHaveBeenCalledTimes(1)
})
