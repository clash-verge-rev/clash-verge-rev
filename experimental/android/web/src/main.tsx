import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NativeBridge, redact } from './bridge.ts'
import { PreviewBridge } from './preview.ts'
import type {
  BridgeMethods,
  LogItem,
  Mode,
  Page,
  Profile,
  ProxyGroup,
  Status,
} from './types.ts'
import './style.css'
import logo from './logo.svg?inline'

const native = window.VergeNative ? new NativeBridge(window.VergeNative) : null
if (native) window.__vergeReceive = native.receive
const bridge = native ?? new PreviewBridge()
const initialStatus: Status = {
  platform: native ? 'android' : 'preview',
  vpn: 'stopped',
  coreReady: false,
}
const modeNames: Record<Mode, string> = {
  rule: '规则',
  global: '全局',
  direct: '直连',
}
const pageNames: Record<Page, string> = {
  home: '首页',
  proxies: '代理',
  profiles: '订阅',
  settings: '设置',
  logs: '运行日志',
}

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v11h5v-7h4v7h5V9" />
      </>
    ),
    proxies: (
      <>
        <path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0" />
        <circle cx="12" cy="20" r=".8" />
      </>
    ),
    profiles: (
      <>
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M8 6h.01M8 17h.01M12 6h4M12 17h4" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-.5 2-2 .9L4.6 5l-2 3.5L4 10v3l-1.4 1.5 2 3.5 1.9-.9 2 .9.5 3h6l.5-3 2-.9 1.9.9 2-3.5L20 13v-3l1.4-1.5-2-3.5-1.9.9-2-.9L15 3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    power: (
      <>
        <path d="M12 2v10M6.5 5.5a9 9 0 1 0 11 0" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    check: <path d="m5 12 4 4 10-10" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6" />
      </>
    ),
    log: (
      <>
        <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.info}
    </svg>
  )
}

function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: string
  title: string
  text: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  )
}

function App() {
  const [page, setPage] = useState<Page>('home')
  const [status, setStatus] = useState<Status>(initialStatus)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [groups, setGroups] = useState<ProxyGroup[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importKind, setImportKind] = useState<'url' | 'file'>('url')
  const [profileName, setProfileName] = useState('')
  const [input, setInput] = useState('')
  const [theme, setTheme] = useState(
    () => localStorage.getItem('verge-mobile.theme') || 'system',
  )
  const importing = useRef<HTMLDialogElement>(null)
  const refreshing = useRef(false)
  const operation = useRef(false)
  const activeProfile =
    profiles.find((p) => p.active) ??
    profiles.find((p) => p.id === status.activeProfileId)
  const connected = status.vpn === 'running'

  const refresh = useCallback(
    async (nextPage: Page = page) => {
      if (refreshing.current) return
      refreshing.current = true
      try {
        const [nextStatus, nextProfiles] = await Promise.all([
          bridge.call('status', {}),
          bridge.call('profiles.list', {}),
        ])
        setStatus(nextStatus)
        setProfiles(nextProfiles)
        if (nextPage === 'proxies' && nextStatus.vpn === 'running')
          setGroups(await bridge.call('proxies.list', {}))
        if (nextStatus.vpn !== 'running') setGroups([])
        if (nextPage === 'logs') setLogs(await bridge.call('logs.list', {}))
        setError('')
      } catch (failure) {
        setError(
          redact(failure instanceof Error ? failure.message : '服务暂时不可用'),
        )
      } finally {
        refreshing.current = false
        setLoading(false)
      }
    },
    [page],
  )

  useEffect(() => {
    void refresh()
    const interval = setInterval(
      () => {
        if (!operation.current) void refresh()
      },
      page === 'logs' ? 3500 : 2500,
    )
    return () => clearInterval(interval)
  }, [refresh, page])

  useEffect(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (dark.matches ? 'dark' : 'light') : theme
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          'content',
          document.documentElement.dataset.theme === 'dark'
            ? '#12151d'
            : '#f7f8fc',
        )
    }
    localStorage.setItem('verge-mobile.theme', theme)
    update()
    dark.addEventListener('change', update)
    return () => dark.removeEventListener('change', update)
  }, [theme])

  useEffect(() => {
    const onBack = () => {
      const hash = location.hash.slice(1) as Page
      setPage(hash in pageNames ? hash : 'home')
    }
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
  }, [])

  useEffect(() => {
    if (showImport) importing.current?.showModal()
    else importing.current?.close()
  }, [showImport])

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timeout)
  }, [notice])

  const navigate = (next: Page) => {
    if (next !== page) history.pushState({ page: next }, '', `#${next}`)
    setPage(next)
    setSearch('')
    setError('')
    void refresh(next)
  }

  const act = async (
    key: string,
    action: () => Promise<unknown>,
    success?: string,
  ) => {
    if (operation.current) return
    operation.current = true
    setBusy(key)
    setNotice('')
    try {
      await action()
      if (success) setNotice(success)
      await refresh()
    } catch (failure) {
      setNotice(
        redact(failure instanceof Error ? failure.message : '操作失败，请重试'),
      )
    } finally {
      operation.current = false
      setBusy('')
    }
  }

  const call = <M extends keyof BridgeMethods>(
    method: M,
    params: BridgeMethods[M]['params'],
  ) => bridge.call(method, params)
  const connect = () => {
    if (!activeProfile && !connected) {
      setShowImport(true)
      return
    }
    void act('vpn', () => call(connected ? 'vpn.stop' : 'vpn.start', {}))
  }

  const importProfile = (event: React.FormEvent) => {
    event.preventDefault()
    if (!input.trim()) {
      setNotice(
        importKind === 'url' ? '请输入订阅链接' : '请粘贴或选择 YAML 配置',
      )
      return
    }
    if (importKind === 'url') {
      try {
        const url = new URL(input.trim())
        if (url.protocol !== 'https:') throw new Error()
      } catch {
        setNotice('请使用有效的 HTTPS 订阅链接')
        return
      }
    }
    void act(
      'import',
      async () => {
        const profile = await call('profiles.import', {
          name: profileName.trim() || '新订阅',
          ...(importKind === 'url'
            ? { url: input.trim() }
            : { content: input }),
        })
        if (!activeProfile) await call('profiles.activate', { id: profile.id })
        setShowImport(false)
        setInput('')
        setProfileName('')
      },
      '配置已导入',
    )
  }

  const modeControls = (
    <div className="segmented mode-control" aria-label="代理模式">
      {(Object.keys(modeNames) as Mode[]).map((mode) => (
        <button
          key={mode}
          disabled={!!busy || !connected}
          className={status.mode === mode ? 'selected' : ''}
          onClick={() =>
            void act('mode', () => call('settings.mode', { mode }))
          }
        >
          {modeNames[mode]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="app">
      <header className="topbar">
        {page === 'logs' ? (
          <button
            className="icon-button"
            aria-label="返回首页"
            onClick={() => navigate('home')}
          >
            <Icon name="back" />
          </button>
        ) : (
          <img className="brand-icon" src={logo} alt="" />
        )}
        <div className="brand-copy">
          <span>{page === 'home' ? 'Verge Mobile' : pageNames[page]}</span>
          <small>
            {page === 'home' ? 'Clash Verge Rev · 手机版' : 'VERGE MOBILE'}
          </small>
        </div>
        <span
          className={`platform-badge ${status.platform === 'preview' ? 'preview' : ''}`}
        >
          {status.platform === 'harmony'
            ? 'HarmonyOS'
            : status.platform === 'android'
              ? 'Android'
              : '界面预览'}
        </span>
      </header>
      <main>
        {error && (
          <div className="error-banner" role="alert">
            <Icon name="info" />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="重试"
              onClick={() => void refresh()}
            >
              <Icon name="refresh" />
            </button>
          </div>
        )}
        {page === 'home' && (
          <>
            <section
              className={`connection-hero ${connected ? 'connected' : ''}`}
            >
              <div className="eyebrow">
                <span className="status-dot" />
                {loading
                  ? '读取连接状态'
                  : connected
                    ? 'VPN 正在运行'
                    : status.vpn === 'connecting' || busy === 'vpn'
                      ? '正在处理连接'
                      : 'VPN 未连接'}
              </div>
              <button
                className={`power-button ${busy === 'vpn' || status.vpn === 'connecting' ? 'working' : ''}`}
                disabled={!!busy || loading}
                aria-label={connected ? '断开 VPN' : '连接 VPN'}
                onClick={connect}
              >
                <Icon name="power" size={43} />
              </button>
              <h1>
                {connected
                  ? '已连接'
                  : status.vpn === 'connecting' || busy === 'vpn'
                    ? '正在连接'
                    : '未连接'}
              </h1>
              <p>
                {connected
                  ? '点击断开 VPN'
                  : activeProfile
                    ? '点击连接，流量按配置分流'
                    : '导入一份订阅，开始连接'}
              </p>
              {status.lastError && (
                <p className="connection-error">{redact(status.lastError)}</p>
              )}
            </section>
            <section className="section">
              <div className="section-heading">
                <h2>当前配置</h2>
                <button
                  className="text-button"
                  onClick={() => navigate('profiles')}
                >
                  管理 <Icon name="chevron" size={15} />
                </button>
              </div>
              <button
                className="profile-summary surface"
                onClick={() =>
                  activeProfile ? navigate('profiles') : setShowImport(true)
                }
              >
                <span className="row-icon">
                  <Icon name={activeProfile ? 'profiles' : 'plus'} />
                </span>
                <span className="row-copy">
                  <strong>{activeProfile?.name || '添加订阅'}</strong>
                  <small>
                    {activeProfile
                      ? activeProfile.sourceHost || '本地 YAML 配置'
                      : '支持订阅链接和 YAML 文件'}
                  </small>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            </section>
            <section className="section">
              <div className="section-heading">
                <h2>代理模式</h2>
                <span className="subtle">
                  {connected ? '即时生效' : '连接后可切换'}
                </span>
              </div>
              {modeControls}
              <p className="mode-help">
                {status.mode === 'global'
                  ? '所有流量通过选定的代理节点'
                  : status.mode === 'direct'
                    ? '所有流量直接访问目标网络'
                    : '根据配置规则选择代理或直连'}
              </p>
            </section>
            <section className="surface rows">
              <button onClick={() => navigate('proxies')}>
                <span className="row-icon">
                  <Icon name="proxies" />
                </span>
                <span className="row-copy">
                  <strong>代理节点</strong>
                  <small>
                    {connected ? '选择节点与测试延迟' : '连接后查看可用节点'}
                  </small>
                </span>
                <Icon name="chevron" size={18} />
              </button>
              <button onClick={() => navigate('logs')}>
                <span className="row-icon">
                  <Icon name="log" />
                </span>
                <span className="row-copy">
                  <strong>运行日志</strong>
                  <small>查看连接和内核消息</small>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            </section>
            <div className="local-note">
              <Icon name="shield" size={15} />
              <span>配置仅保存在本机</span>
            </div>
          </>
        )}
        {page === 'proxies' && (
          <>
            <div className="page-tools">
              {modeControls}
              <button
                className="icon-button"
                aria-label="刷新节点"
                disabled={!!busy}
                onClick={() => void act('refresh', () => refresh('proxies'))}
              >
                <Icon name="refresh" />
              </button>
            </div>
            {!connected ? (
              <Empty
                icon="proxies"
                title="先连接 VPN"
                text="连接后可以查看代理组、切换节点和测试延迟。"
                action={
                  <button
                    className="primary-button"
                    onClick={() => navigate('home')}
                  >
                    前往连接
                  </button>
                }
              />
            ) : !groups.length ? (
              <Empty
                icon="proxies"
                title="暂无代理组"
                text="请检查当前配置是否包含代理组，或刷新后重试。"
                action={
                  <button
                    className="outline-button"
                    onClick={() => void refresh('proxies')}
                  >
                    刷新
                  </button>
                }
              />
            ) : (
              <>
                <label className="search">
                  <Icon name="search" size={19} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索节点或代理组"
                    aria-label="搜索节点或代理组"
                  />
                </label>
                <div className="proxy-groups">
                  {groups.map((group) => {
                    const matches = group.name
                      .toLowerCase()
                      .includes(search.toLowerCase())
                    const nodes = group.all.filter(
                      (node) =>
                        matches ||
                        node.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    if (!nodes.length) return null
                    return (
                      <section className="proxy-group surface" key={group.name}>
                        <div className="group-heading">
                          <div>
                            <h2>{group.name}</h2>
                            <span>
                              {group.type} · {group.all.length} 个节点
                            </span>
                          </div>
                          {group.type.toLowerCase() !== 'selector' && (
                            <span className="small-tag">自动选择</span>
                          )}
                        </div>
                        <div className="node-list">
                          {nodes.map((node) => (
                            <div
                              className={`node-row ${group.now === node.name ? 'selected' : ''}`}
                              key={node.name}
                            >
                              <button
                                className="node-choice"
                                disabled={
                                  !!busy ||
                                  group.type.toLowerCase() !== 'selector'
                                }
                                onClick={() =>
                                  void act(
                                    'node',
                                    () =>
                                      call('proxies.select', {
                                        group: group.name,
                                        name: node.name,
                                      }),
                                    '节点已切换',
                                  )
                                }
                              >
                                <span className="node-mark">
                                  {group.now === node.name ? (
                                    <Icon name="check" size={16} />
                                  ) : (
                                    <span />
                                  )}
                                </span>
                                <span className="row-copy">
                                  <strong>{node.name}</strong>
                                  <small>{node.type}</small>
                                </span>
                              </button>
                              <button
                                className="delay-button"
                                disabled={!!busy || !status.canTestDelay}
                                aria-label={`测试 ${node.name} 延迟`}
                                onClick={() =>
                                  void act('delay', async () => {
                                    const reply = await call('proxies.delay', {
                                      name: node.name,
                                    })
                                    setGroups((previous) =>
                                      previous.map((g) => ({
                                        ...g,
                                        all: g.all.map((n) =>
                                          n.name === node.name
                                            ? { ...n, delay: reply.delay }
                                            : n,
                                        ),
                                      })),
                                    )
                                  })
                                }
                                style={
                                  !status.canTestDelay && !node.delay
                                    ? { display: 'none' }
                                    : undefined
                                }
                              >
                                {typeof node.delay === 'number' &&
                                node.delay > 0
                                  ? `${node.delay} ms`
                                  : '测速'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
        {page === 'profiles' && (
          <>
            <div className="page-intro">
              <div>
                <h1>订阅配置</h1>
                <p>导入、更新与切换你的配置</p>
              </div>
              <button
                className="icon-button filled"
                aria-label="导入配置"
                onClick={() => setShowImport(true)}
              >
                <Icon name="plus" />
              </button>
            </div>
            {!profiles.length ? (
              <Empty
                icon="profiles"
                title="添加你的第一份订阅"
                text="粘贴 HTTPS 订阅链接，或导入 Clash / Mihomo YAML 文件。"
                action={
                  <button
                    className="primary-button"
                    onClick={() => setShowImport(true)}
                  >
                    <Icon name="plus" size={18} /> 导入配置
                  </button>
                }
              />
            ) : (
              <div className="profile-list">
                {profiles.map((profile) => (
                  <article
                    key={profile.id}
                    className={`profile-card surface ${profile.active ? 'active' : ''}`}
                  >
                    <div className="profile-card-top">
                      <span className="row-icon">
                        <Icon name="profiles" />
                      </span>
                      <div className="row-copy">
                        <h2>{profile.name}</h2>
                        <span>{profile.sourceHost || '本地 YAML'}</span>
                      </div>
                      {profile.active && (
                        <span className="small-tag">使用中</span>
                      )}
                    </div>
                    <div className="profile-meta">
                      <Icon name="clock" size={14} />
                      {profile.updatedAt &&
                      !Number.isNaN(Date.parse(profile.updatedAt))
                        ? `更新于 ${new Date(profile.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                        : '已保存到本机'}
                    </div>
                    <div className="profile-actions">
                      <button
                        className="outline-button"
                        disabled={!!busy || profile.active}
                        onClick={() =>
                          void act(
                            'profile',
                            () => call('profiles.activate', { id: profile.id }),
                            '当前配置已切换',
                          )
                        }
                      >
                        {profile.active ? '当前配置' : '使用此配置'}
                      </button>
                      {profile.sourceHost && (
                        <button
                          className="icon-button"
                          disabled={!!busy}
                          aria-label={`更新 ${profile.name}`}
                          onClick={() =>
                            void act(
                              'update',
                              () => call('profiles.update', { id: profile.id }),
                              '订阅已更新',
                            )
                          }
                        >
                          <Icon name="refresh" />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {page === 'settings' && (
          <>
            <div className="page-intro">
              <div>
                <h1>设置</h1>
                <p>外观与运行信息</p>
              </div>
            </div>
            <section className="section">
              <div className="section-heading">
                <h2>外观</h2>
              </div>
              <div className="segmented">
                {[
                  ['system', '跟随系统'],
                  ['light', '浅色'],
                  ['dark', '深色'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={theme === value ? 'selected' : ''}
                    onClick={() => setTheme(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <section className="surface rows">
              <div>
                <span className="row-icon">
                  <Icon name="shield" />
                </span>
                <span className="row-copy">
                  <strong>代理内核</strong>
                  <small>
                    {status.coreVersion ||
                      (status.coreReady ? 'Mihomo · 已就绪' : '等待系统服务')}
                  </small>
                </span>
              </div>
              <div>
                <span className="row-icon">
                  <Icon name="profiles" />
                </span>
                <span className="row-copy">
                  <strong>当前配置</strong>
                  <small>{activeProfile?.name || '尚未导入'}</small>
                </span>
              </div>
              <button onClick={() => navigate('logs')}>
                <span className="row-icon">
                  <Icon name="log" />
                </span>
                <span className="row-copy">
                  <strong>运行日志</strong>
                  <small>查看运行状态和错误</small>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            </section>
            {status.platform === 'android' && (
              <button
                className="outline-button full"
                style={{ marginTop: 18 }}
                disabled={!!busy}
                onClick={() =>
                  void act('native.settings', () => call('native.settings', {}))
                }
              >
                高级网络设置 <Icon name="chevron" size={16} />
              </button>
            )}
            <section className="about">
              <img src={logo} alt="" />
              <h2>
                Verge Mobile <span>0.1.0</span>
              </h2>
              <p>基于 Clash Verge Rev 的独立移动端移植</p>
              <p className="subtle">GPL-3.0 · Android & HarmonyOS NEXT</p>
            </section>
          </>
        )}
        {page === 'logs' && (
          <>
            <div className="page-intro">
              <div>
                <h1>运行日志</h1>
                <p>最近的内核与系统消息</p>
              </div>
              <button
                className="icon-button"
                aria-label="刷新日志"
                disabled={!!busy}
                onClick={() => void refresh('logs')}
              >
                <Icon name="refresh" />
              </button>
            </div>
            {!logs.length ? (
              <Empty
                icon="log"
                title="暂无日志"
                text="连接或配置操作产生的消息会显示在这里。"
              />
            ) : (
              <ol className="logs">
                {logs
                  .slice(-300)
                  .reverse()
                  .map((log, i) => (
                    <li key={`${log.time}-${i}`} className="surface">
                      <div>
                        <time>
                          {log.time && !Number.isNaN(Date.parse(log.time))
                            ? new Date(log.time).toLocaleTimeString('zh-CN')
                            : log.time}
                        </time>
                        <span
                          className={`log-level ${log.level.toLowerCase()}`}
                        >
                          {log.level}
                        </span>
                      </div>
                      <p>{redact(log.message)}</p>
                    </li>
                  ))}
              </ol>
            )}
          </>
        )}
      </main>
      <nav className="bottom-nav" aria-label="主导航">
        {(['home', 'proxies', 'profiles', 'settings'] as Page[]).map((item) => (
          <button
            key={item}
            className={
              page === item || (page === 'logs' && item === 'home')
                ? 'active'
                : ''
            }
            aria-current={page === item ? 'page' : undefined}
            onClick={() => navigate(item)}
          >
            <span>
              <Icon name={item} />
            </span>
            <small>{pageNames[item]}</small>
          </button>
        ))}
      </nav>
      <dialog
        ref={importing}
        className="import-dialog"
        onCancel={(event) => {
          if (busy) event.preventDefault()
          else setShowImport(false)
        }}
        onClose={() => setShowImport(false)}
      >
        <form onSubmit={importProfile}>
          <div className="dialog-heading">
            <div>
              <h2>导入配置</h2>
              <p>订阅链接或本地 YAML</p>
            </div>
            <button
              type="button"
              disabled={!!busy}
              className="icon-button"
              aria-label="关闭导入"
              onClick={() => setShowImport(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={importKind === 'url' ? 'selected' : ''}
              onClick={() => {
                setImportKind('url')
                setInput('')
              }}
            >
              订阅链接
            </button>
            <button
              type="button"
              className={importKind === 'file' ? 'selected' : ''}
              onClick={() => {
                setImportKind('file')
                setInput('')
              }}
            >
              YAML 配置
            </button>
          </div>
          <label className="field">
            配置名称
            <input
              maxLength={100}
              placeholder="例如：我的订阅"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
          </label>
          <label className="field">
            {importKind === 'url' ? 'HTTPS 订阅链接' : 'YAML 配置'}
            {importKind === 'url' ? (
              <input
                type="url"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="https://…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            ) : (
              <textarea
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="粘贴 Clash / Mihomo YAML 配置"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            )}
          </label>
          {importKind === 'file' && status.canChooseFile && (
            <label className="file-choice">
              选择 YAML 文件
              <input
                type="file"
                accept=".yaml,.yml,text/yaml,application/yaml,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 10 * 1024 * 1024) {
                    setNotice('配置文件不能超过 10 MB')
                    return
                  }
                  void file
                    .text()
                    .then((text) => {
                      setInput(text)
                      if (!profileName)
                        setProfileName(file.name.replace(/\.ya?ml$/i, ''))
                    })
                    .catch(() => setNotice('无法读取文件，请重试'))
                }}
              />
            </label>
          )}
          <p className="field-help">
            配置和订阅链接保存在本机；更新订阅时会访问订阅提供方。
          </p>
          <button
            type="submit"
            className="primary-button full"
            disabled={!!busy}
          >
            {busy === 'import' ? '正在导入…' : '导入配置'}
          </button>
        </form>
      </dialog>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice('')}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
