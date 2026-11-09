import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

import { formatConnectionTraffic } from './connection-row-view'
import { ConnectionTable } from './connection-table'

const sorting = vi.hoisted(() => ({ id: 'download', desc: false }))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [
    initial === null ? sorting : initial,
    vi.fn(),
  ],
}))
vi.mock('foxact/use-local-storage', () => ({
  useLocalStorage: (_key: string, initial: unknown) => [initial, vi.fn()],
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('./connection-column-manager', () => ({
  ConnectionColumnManager: () => null,
}))
vi.mock('./connection-relative-time', () => ({
  RelativeTime: () => null,
}))
vi.mock('./connection-row-view', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./connection-row-view')>()
  return {
    ...original,
    formatConnectionTraffic: vi.fn(original.formatConnectionTraffic),
  }
})

it('sorts numeric columns above the cache bound while formatting only virtual rows', () => {
  const connections: IConnectionsItem[] = Array.from(
    { length: 2_101 },
    (_, i) => ({
      id: `${i}`,
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        host: `host-${i}`,
        sourceIP: '',
        sourcePort: '',
        destinationPort: '443',
      },
      chains: [],
      rule: '',
      rulePayload: '',
      start: '',
      upload: (i * 3) % 2_101,
      download: (i * 5) % 2_101,
      curUpload: (i * 7) % 2_101,
      curDownload: (i * 11) % 2_101,
    }),
  )

  for (const [column, field] of [
    ['download', 'download'],
    ['upload', 'upload'],
    ['dlSpeed', 'curDownload'],
    ['ulSpeed', 'curUpload'],
  ] as const) {
    for (const desc of [false, true]) {
      sorting.id = column
      sorting.desc = desc
      vi.mocked(formatConnectionTraffic).mockClear()
      const html = renderToStaticMarkup(
        createElement(ConnectionTable, {
          connections,
          onShowDetail: vi.fn(),
          columnManagerOpen: false,
          onCloseColumnManager: vi.fn(),
        }),
      )
      const expected = connections
        .slice()
        .sort((a, b) => ((a[field] ?? 0) - (b[field] ?? 0)) * (desc ? -1 : 1))
      expect(html.match(/host-\d+:443/g)).toEqual(
        expected.slice(0, 6).map((row) => `${row.metadata.host}:443`),
      )
      expect(formatConnectionTraffic).toHaveBeenCalledTimes(24)
    }
  }
  expect(connections[0].id).toBe('0')
  expect(connections.at(-1)?.id).toBe('2100')
})
