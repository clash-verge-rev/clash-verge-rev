import { ThemeProvider, createTheme } from '@mui/material'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'

import { VirtualList } from '../../src/components/base/virtual-list'
import { ConnectionRowItem } from '../../src/components/connection/connection-row-item'
import { useConnectionRowViews } from '../../src/components/connection/connection-row-view'
import LogItem from '../../src/components/log/log-item'
import { initializeLanguage } from '../../src/services/i18n'
import { setPreloadConfig } from '../../src/services/preload'

import { layer, scenario, subscribe } from './replay'
import '../../src/assets/styles/page.scss'

const searchState = {
  text: '',
  matchCase: false,
  matchWholeWord: false,
  useRegularExpression: false,
}
export function Components() {
  const [logs, setLogs] = useState<ILogItem[]>([])
  const [connections, setConnections] = useState<IConnectionsItem[]>([])
  useEffect(
    () =>
      subscribe(({ payload }) => {
        if (scenario === 'logs')
          setLogs((previous) =>
            previous.concat(payload as ILogItem[]).slice(-1000),
          )
        else setConnections((payload as IConnections).connections)
      }),
    [],
  )
  const rows = useConnectionRowViews(connections)
  return (
    <VirtualList
      count={scenario === 'logs' ? logs.length : rows.length}
      estimateSize={scenario === 'logs' ? 50 : 56}
      style={{ height: 640, margin: 24 }}
      renderItem={(index) =>
        scenario === 'logs' ? (
          <LogItem
            value={logs[logs.length - 1 - index]}
            searchState={searchState}
          />
        ) : (
          <ConnectionRowItem
            row={rows[index]}
            closed={false}
            onShowDetail={() => {}}
          />
        )
      }
    />
  )
}
dayjs.extend(relativeTime)
const root = document.getElementById('root')!
setPreloadConfig({
  language: 'en',
  theme_mode: 'light',
  pause_render_traffic_stats_on_blur: false,
} as IVergeConfig)
await initializeLanguage('en')
const Scene =
  layer === 'component'
    ? Components
    : scenario === 'logs'
      ? (await import('../../src/pages/logs')).default
      : (await import('../../src/pages/connections')).default
createRoot(root).render(
  <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: false }}>
    <ThemeProvider theme={createTheme()}>
      <Scene />
    </ThemeProvider>
  </SWRConfig>,
)
