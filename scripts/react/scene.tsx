import { ThemeProvider, createTheme } from '@mui/material'
import {
  Profiler,
  StrictMode,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'

import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import { DnsViewer } from '@/components/setting/mods/dns-viewer'
import { useProxyDelayState } from '@/hooks/use-proxy-delay-state'

import { delayFixture } from './delay'
import { profiler, recordRender } from './profiler'
import { fixture } from './state'

const member = (name: string): any =>
  name === 'Unknown'
    ? {
        kind: 'unresolved',
        ref: { kind: 'unresolved', name, reason: 'missing' },
      }
    : {
        kind: 'node',
        ref: { kind: 'node', recordId: name, name },
        node: { name, history: [], source: { kind: 'core', proxyName: name } },
      }
let update: (patch?: any) => void
let open: () => void
let delay: ReturnType<typeof useProxyDelayState>
let previous: unknown
let childRenders = 0
const DelayValue = memo(({ state }: any) => {
  childRenders++
  return <output id="delay">{JSON.stringify(state)}</output>
})
function DelayProbe({ name, group }: any) {
  const resolved = useMemo(() => member(name), [name])
  const current = useProxyDelayState(resolved, group)
  useEffect(() => {
    delay = current
  })
  return <DelayValue state={current.delayState} />
}
function Scene() {
  const [state, setState] = useState({
    revision: 0,
    name: 'Node 1',
    group: 'Group 1',
    mounted: true,
  })
  const ref = useRef<any>(null)
  useEffect(() => {
    update = (patch = {}) =>
      setState((old) => ({ ...old, ...patch, revision: old.revision + 1 }))
    open = () => ref.current.open()
  }, [])
  const mode = fixture.theme
  const theme = useMemo(() => createTheme({ palette: { mode } }), [mode])
  return (
    <ThemeProvider theme={theme}>
      <main data-revision={state.revision}>
        <section id="tabs" key={state.mounted ? 'mounted' : 'reset'}>
          <ProxyTunCard />
        </section>
        <DnsViewer ref={ref} />
        {state.mounted && <DelayProbe name={state.name} group={state.group} />}
      </main>
    </ThemeProvider>
  )
}
const strict = new URLSearchParams(location.search).has('strict')
const app = (
  <Profiler id="fixtures" onRender={recordRender}>
    <Scene />
  </Profiler>
)
createRoot(document.getElementById('root')!).render(
  strict ? <StrictMode>{app}</StrictMode> : app,
)
Object.assign(window, {
  __REACT_AB__: {
    update: (patch?: any) => update(patch),
    open: () => open(),
    fixture,
    delay: delayFixture,
    request: () => {
      void delay.onDelay()
    },
    remember: () => {
      previous = delay.delayState
    },
    checkCollector: () => {
      profiler.clear()
      for (let index = 0; index < 1005; index++)
        recordRender(String(index), 'update', 1, 2, 3, 4)
      const records = profiler.read()
      records[0][0] = 'changed copy'
      const preserved = profiler.read()
      const result = {
        length: preserved.length,
        first: preserved[0][0],
        last: preserved.at(-1)![0],
        copied: preserved[0][0] === '5',
        cleared: false,
      }
      profiler.clear()
      result.cleared = profiler.read().length === 0
      return result
    },
    read: () => ({
      fixture,
      profile: profiler.read(),
      childRenders,
      sameReference: previous === delay.delayState,
      delay: delay.delayState,
      listeners: [...delayFixture.listeners.keys()],
    }),
  },
})
