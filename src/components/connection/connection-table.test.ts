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

it('formats only virtual rows when sorting numeric columns above the cache bound', () => {
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

  for (const column of ['download', 'upload', 'dlSpeed', 'ulSpeed']) {
    sorting.id = column
    vi.mocked(formatConnectionTraffic).mockClear()
    renderToStaticMarkup(
      createElement(ConnectionTable, {
        connections,
        onShowDetail: vi.fn(),
        columnManagerOpen: false,
        onCloseColumnManager: vi.fn(),
      }),
    )
    expect(formatConnectionTraffic).toHaveBeenCalledTimes(24)
  }
})
