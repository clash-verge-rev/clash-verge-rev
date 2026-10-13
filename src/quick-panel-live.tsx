import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  closeAllConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import {
  QuickPanel,
  type QuickGroup,
  type QuickMode,
} from './components/quick-panel/quick-panel'
import {
  buildQuickGroups,
  FAVORITES_KEY,
  favoriteScope,
  type Favorites,
} from './components/quick-panel/quick-panel-data'
import { cleanupConnections } from './hooks/use-proxy-selection'
import { useTrafficData } from './hooks/use-traffic-data'
import enLabels from './locales/en/quickPanel.json'
import zhLabels from './locales/zh/quickPanel.json'
import {
  getVergeConfig,
  getProfiles,
  getProxyView,
  getClashMode,
  getSystemProxy,
  getAutoProxy,
  getClashInfo,
  getRuntimeState,
  getEmbeddedServerPort,
  patchVergeConfig,
  patchClashMode,
  recordSelectedNode,
  syncTrayProxySelection,
  patchProfilesConfig,
  openQuickPanelDashboard,
} from './services/cmds'

const nativeWindow = getCurrentWindow()

async function readSnapshot() {
  const [verge, profiles, view, mode, system, auto, info, runtime, pacPort] =
    await Promise.all([
      getVergeConfig(),
      getProfiles(),
      getProxyView(),
      getClashMode(),
      getSystemProxy(),
      getAutoProxy(),
      getClashInfo(),
      getRuntimeState(),
      getEmbeddedServerPort(),
    ])
  const host = verge.proxy_host || '127.0.0.1'
  const systemProxy = verge.proxy_auto_config
    ? auto.enable && auto.url === `http://${host}:${pacPort}/commands/pac`
    : system.enable && system.server === `${host}:${info.mixed_port}`
  return {
    verge,
    profiles,
    view,
    mode: mode as QuickMode,
    systemProxy,
    runtime,
  }
}

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'detail' in error
      ? String(error.detail)
      : String(error)
const rate = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB/s`
    : `${(bytes / 1024).toFixed(0)} KB/s`

function loadFavorites(): { data: Favorites; error: string } {
  try {
    const saved = JSON.parse(
      localStorage.getItem(FAVORITES_KEY) || '{}',
    ) as Favorites
    if (
      !saved ||
      typeof saved !== 'object' ||
      Array.isArray(saved) ||
      Object.values(saved).some(
        (nodes) =>
          !Array.isArray(nodes) ||
          nodes.length > 3 ||
          nodes.some(
            (node) =>
              !node ||
              typeof node.id !== 'string' ||
              typeof node.name !== 'string' ||
              typeof node.region !== 'string',
          ),
      )
    )
      throw new Error(zhLabels.storageError)
    return { data: saved, error: '' }
  } catch (err) {
    return { data: {}, error: errorMessage(err) }
  }
}

export function LivePanel() {
  const [snapshot, setSnapshot] =
    useState<Awaited<ReturnType<typeof readSnapshot>>>()
  const [favoriteState, setFavoriteState] = useState(loadFavorites)
  const favorites = favoriteState.data
  const [groupId, setGroupId] = useState('')
  const [error, setError] = useState(favoriteState.error)
  const [readError, setReadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(true)
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const operationRef = useRef(false)
  const refreshRef = useRef<Promise<void> | null>(null)
  const { response } = useTrafficData({ enabled: visible })

  const refresh = async () => {
    if (refreshRef.current) return refreshRef.current
    const pending = readSnapshot()
      .then((data) => {
        setSnapshot(data)
        setReadError('')
      })
      .catch((err: unknown) => setReadError(errorMessage(err)))
      .finally(() => {
        refreshRef.current = null
      })
    refreshRef.current = pending
    return pending
  }

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onTheme = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onTheme)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void nativeWindow.hide()
    }
    document.addEventListener('keydown', onKey)
    const unlisten = nativeWindow.onFocusChanged(({ payload }) => {
      setVisible(payload)
      if (payload) void refresh()
    })
    void refresh()
    const timer = setInterval(() => {
      void nativeWindow.isVisible().then((value) => {
        setVisible(value)
        if (value && !operationRef.current) void refresh()
      })
    }, 2000)
    return () => {
      clearInterval(timer)
      media.removeEventListener('change', onTheme)
      document.removeEventListener('keydown', onKey)
      void unlisten.then((stop) => stop())
    }
  }, [])

  const act = async (action: () => Promise<unknown>) => {
    if (operationRef.current) return
    operationRef.current = true
    setBusy(true)
    setError('')
    try {
      await refreshRef.current
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      await refresh()
      setBusy(false)
      operationRef.current = false
    }
  }

  const labels =
    (snapshot?.verge.language ?? 'zh') === 'zh' ? zhLabels : enLabels
  const profile = snapshot?.profiles.current ?? ''
  const groups = snapshot
    ? buildQuickGroups(snapshot.view, profile, favorites)
    : []
  const mode = snapshot?.mode ?? 'rule'
  const group =
    (mode === 'global'
      ? groups.find((item) => item.id === snapshot?.view.global?.name)
      : (groups.find((item) => item.id === groupId) ??
        groups.find((item) => item.id !== snapshot?.view.global?.name))) ??
    ({
      id: '',
      name: labels.noGroups,
      nodes: [],
      selected: '',
      favorites: [],
    } satisfies QuickGroup)
  const themeMode = snapshot?.verge.theme_mode
  const dark = themeMode === 'dark' || (themeMode !== 'light' && systemDark)
  const openDashboard = (route: string) =>
    void act(async () => {
      await openQuickPanelDashboard(route)
      await nativeWindow.hide()
    })

  return (
    <main className="qp-preview qp-live" data-theme={dark ? 'dark' : 'light'}>
      {(error || readError) && (
        <p className="qp-message" role="alert">
          {error || readError}
          <button
            onClick={() => {
              setError('')
              void refresh()
            }}
          >
            {labels.retry}
          </button>
          <button onClick={() => openDashboard('/')}>{labels.dashboard}</button>
        </p>
      )}
      {!snapshot ? (
        <p role="status">{labels.loading}</p>
      ) : (
        <>
          {busy && (
            <p className="qp-message" role="status">
              {labels.applying}
            </p>
          )}
          <fieldset className="qp-operation" disabled={busy || !!readError}>
            <QuickPanel
              language={snapshot.verge.language ?? 'zh'}
              systemProxy={snapshot.systemProxy}
              tun={
                !!snapshot.verge.enable_tun_mode && snapshot.runtime.tunCapable
              }
              tunUnavailable={
                snapshot.runtime.tunCapable ? undefined : labels.tunUnavailable
              }
              mode={mode}
              group={group}
              groups={
                mode === 'global'
                  ? [group]
                  : groups.filter(
                      (item) => item.id !== snapshot.view.global?.name,
                    )
              }
              profile={profile}
              profiles={(snapshot.profiles.items ?? [])
                .filter(
                  (item) =>
                    item.uid &&
                    (item.type === 'remote' || item.type === 'local'),
                )
                .map((item) => ({
                  id: item.uid!,
                  name: item.name || item.uid!,
                }))}
              download={rate(response.data?.down ?? 0)}
              upload={rate(response.data?.up ?? 0)}
              onSystemProxy={() =>
                void act(async () => {
                  if (
                    !snapshot.systemProxy &&
                    snapshot.runtime.mode === 'NotRunning'
                  )
                    throw new Error(labels.coreNotRunning)
                  await patchVergeConfig({
                    enable_system_proxy: !snapshot.systemProxy,
                  })
                  if (
                    snapshot.systemProxy &&
                    snapshot.verge.auto_close_connection
                  )
                    await closeAllConnections()
                })
              }
              onTun={() =>
                void act(() =>
                  patchVergeConfig({
                    enable_tun_mode: !snapshot.verge.enable_tun_mode,
                  }),
                )
              }
              onMode={(next) => void act(() => patchClashMode(next))}
              onGroup={setGroupId}
              onNode={(id) =>
                void act(async () => {
                  const latest = await readSnapshot()
                  if (
                    latest.profiles.current !== profile ||
                    latest.mode !== mode
                  )
                    throw new Error(labels.contextChanged)
                  const node = buildQuickGroups(latest.view, profile, favorites)
                    .find((item) => item.id === group.id)
                    ?.nodes.find((item) => item.id === id)
                  if (!node || !node.available)
                    throw new Error(labels.nodeUnavailable)
                  await selectNodeForGroup(group.id, node.name)
                  await recordSelectedNode(group.id, node.name)
                  await syncTrayProxySelection()
                  const previous = (
                    latest.view.groups.find((item) => item.name === group.id) ??
                    (latest.view.global?.name === group.id
                      ? latest.view.global
                      : undefined)
                  )?.now
                  if (
                    latest.verge.auto_close_connection &&
                    previous &&
                    previous !== node.name
                  ) {
                    await cleanupConnections(previous)
                  }
                })
              }
              onFavorites={(ids) => {
                const next = {
                  ...favorites,
                  [favoriteScope(profile, group.id)]: ids
                    .map((id) => group.nodes.find((node) => node.id === id)!)
                    .map(({ id, name, region }) => ({ id, name, region })),
                }
                try {
                  localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
                  setFavoriteState({ data: next, error: '' })
                } catch (err) {
                  setError(errorMessage(err))
                }
              }}
              onProfile={(current) =>
                void act(() => patchProfilesConfig({ current }))
              }
              onDashboard={() => openDashboard('/')}
              onSettings={() => openDashboard('/settings')}
            />
          </fieldset>
        </>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<LivePanel />)
