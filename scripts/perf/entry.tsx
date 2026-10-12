import { ThemeProvider, createTheme } from '@mui/material'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'

import { EnhancedCanvasTrafficGraph } from '../../src/components/home/enhanced-canvas-traffic-graph'
import { useTrafficMonitorEnhanced } from '../../src/hooks/use-traffic-monitor'
import { initializeLanguage } from '../../src/services/i18n'
import { setPreloadConfig } from '../../src/services/preload'

setPreloadConfig({
  pause_render_traffic_stats_on_blur: false,
} as IVergeConfig)
await initializeLanguage('en')
export function Replay() {
  const {
    graphData: { appendData },
  } = useTrafficMonitorEnhanced({ subscribe: false })
  useEffect(() => {
    let received = 0,
      previous = 0,
      gaps = 0
    const socket = new WebSocket(
      `ws://127.0.0.1:${new URLSearchParams(location.search).get('port')}`,
    )
    socket.onmessage = ({ data }) => {
      const point = JSON.parse(data)
      appendData(point)
      if (previous && point.sequence !== previous + 1) gaps++
      previous = point.sequence
      document.documentElement.dataset.perfReceived = String(++received)
      document.documentElement.dataset.perfGaps = String(gaps)
      document.documentElement.dataset.perfSourceTime = String(point.timestamp)
    }
    return () => socket.close()
  }, [appendData])
  return (
    <main
      aria-label="Home traffic graph replay"
      style={{ width: 920, height: 360, margin: 32 }}
    >
      <EnhancedCanvasTrafficGraph />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(
  <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: false }}>
    <ThemeProvider theme={createTheme()}>
      <Replay />
    </ThemeProvider>
  </SWRConfig>,
)
