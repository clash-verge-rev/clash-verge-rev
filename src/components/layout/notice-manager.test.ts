import { createInstance } from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import settings from '@/locales/en/settings.json'
import {
  getSnapshotNotices,
  hideNotice,
  showNotice,
  syncSidecarFailure,
} from '@/services/notice-service'

import { NoticeManager } from './notice-manager'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
}))
vi.mock('@/utils/open-external-url', () => ({ openExternalUrl: vi.fn() }))

afterEach(() => {
  getSnapshotNotices().forEach(({ id }) => hideNotice(id))
})

it.each([
  [
    'startup',
    'process verge-mihomo remains after IPC failure; refusing a second core',
  ],
  [
    'restart',
    'process verge-mihomo-alpha remains after IPC failure; refusing a second core',
  ],
  [
    'sidecar',
    'Service core rejected: permission denied; Sidecar fallback failed: process verge-mihomo.exe (PID 123) is still running; refusing a second core',
  ],
])(
  'explains an occupied core during %s and preserves diagnostics',
  async (operation, detail) => {
    if (operation === 'startup') {
      showNotice.error('settings.feedback.errors.clash.startFailed', detail)
    } else if (operation === 'restart') {
      showNotice.error({ code: 'CORE_RESTART_FAILED', detail })
    } else {
      syncSidecarFailure({ revision: 1, detail })
    }
    const i18n = createInstance()
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: { settings } } },
    })
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(NoticeManager)),
    )
    expect(html).toContain('a core process is already running')
    expect(html).toContain('Close the related app or stop the leftover process')
    expect(html).toContain(detail)
    if (operation === 'sidecar') {
      expect(html).toContain('service-core-permissions')
      expect(html).toContain('PID 123')
    }
  },
)
