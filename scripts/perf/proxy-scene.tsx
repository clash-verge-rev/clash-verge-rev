import { ThemeProvider, createTheme } from '@mui/material'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'

import { AppDataProvider } from '../../src/providers/app-data-provider'
import { initializeLanguage } from '../../src/services/i18n'
import { setPreloadConfig } from '../../src/services/preload'
import { swrConfig } from '../../src/services/query-client'
import { AppStoreProvider } from '../../src/store/app-store'

import '../../src/assets/styles/page.scss'

const root = document.getElementById('root')!
document.body.style.cssText = 'margin:0;font:14px -apple-system,sans-serif'
root.style.cssText = 'width:1000px;height:700px;overflow:hidden'
new MutationObserver(() => {
  document.documentElement.dataset.perfDraw = String(Date.now())
}).observe(root, { childList: true, characterData: true, subtree: true })

setPreloadConfig({
  language: 'en',
  theme_mode: 'light',
  pause_render_traffic_stats_on_blur: false,
} as IVergeConfig)
await initializeLanguage('en')

const ProxyPage = (await import('../../src/pages/proxies')).default

const findScroller = () => {
  const elements = document.querySelectorAll<HTMLElement>('#root *')
  for (const element of elements) {
    const { overflowY } = getComputedStyle(element)
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      element.scrollHeight > element.clientHeight
    ) {
      return element
    }
  }
  return null
}

// Deterministic sawtooth scrolling keeps the virtualizer measuring, the
// throttled scroll-position save running and the DOM mutating so the perfDraw
// marker tracks view-input delivery. Each applied scroll step counts as one
// delivered view input; the interval keeps delivering (throttled by the
// browser) while the window is hidden and rAF is suspended.
export const ScrollDriver = () => {
  useEffect(() => {
    const data = document.documentElement.dataset
    let stopped = false
    const step = () => {
      const scroller = findScroller()
      if (scroller) {
        const max = scroller.scrollHeight - scroller.clientHeight
        if (max > 0) {
          const next =
            scroller.scrollTop + 36 > max - 36 ? 0 : scroller.scrollTop + 36
          scroller.scrollTop = next
          data.perfScroll = String(Number(data.perfScroll || 0) + 1)
          data.perfDelivered = String(Number(data.perfDelivered || 0) + 1)
        }
      }
    }
    const drive = () => {
      if (stopped) return
      step()
      requestAnimationFrame(drive)
    }
    const handle = requestAnimationFrame(drive)
    const timer = window.setInterval(step, 250)
    return () => {
      stopped = true
      cancelAnimationFrame(handle)
      window.clearInterval(timer)
    }
  }, [])
  return null
}

createRoot(root).render(
  <SWRConfig value={swrConfig}>
    <ThemeProvider theme={createTheme()}>
      <AppStoreProvider>
        <AppDataProvider>
          <ProxyPage />
          <ScrollDriver />
        </AppDataProvider>
      </AppStoreProvider>
    </ThemeProvider>
  </SWRConfig>,
)
