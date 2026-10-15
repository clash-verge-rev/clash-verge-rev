import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  QuickPanel,
  type QuickGroup,
  type QuickMode,
} from './components/quick-panel/quick-panel'
import { quickPanelState } from './services/cmds'

const nativePreview = new URLSearchParams(location.search).has('native')

const initialGroups: QuickGroup[] = [
  {
    id: 'main',
    name: '节点选择',
    selected: 'hk1',
    favorites: ['hk1', 'jp1', 'sg1'],
    nodes: [
      { id: 'hk1', name: '香港 01', region: 'HK', delay: 38 },
      { id: 'jp1', name: '日本 01', region: 'JP', delay: 76 },
      { id: 'sg1', name: '新加坡 01', region: 'SG', delay: 89 },
      { id: 'hk2', name: '香港 02', region: 'HK', delay: 52 },
      { id: 'us1', name: '美国 01', region: 'US', delay: 168 },
    ],
  },
  {
    id: 'media',
    name: '流媒体',
    selected: 'jp2',
    favorites: ['jp2', 'sg2'],
    nodes: [
      { id: 'jp2', name: '日本 02', region: 'JP', delay: 82 },
      { id: 'sg2', name: '新加坡 02', region: 'SG', delay: null },
    ],
  },
  {
    id: 'global',
    name: 'GLOBAL',
    selected: 'hk1',
    favorites: ['hk1', 'jp1', 'sg1'],
    nodes: [
      { id: 'hk1', name: '香港 01', region: 'HK', delay: 38 },
      { id: 'jp1', name: '日本 01', region: 'JP', delay: 76 },
      { id: 'sg1', name: '新加坡 01', region: 'SG', delay: 89 },
    ],
  },
]

export function Preview() {
  useEffect(() => {
    if (!nativePreview) return
    const observer = new ResizeObserver(() => {
      void quickPanelState(document.querySelector('main')!.scrollHeight)
    })
    observer.observe(document.querySelector('main')!)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void quickPanelState(null, true)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  const [groups, setGroups] = useState(initialGroups)
  const [groupId, setGroupId] = useState('main')
  const [mode, setMode] = useState<QuickMode>('rule')
  const [systemProxy, setSystemProxy] = useState(true)
  const [tun, setTun] = useState(false)
  const [profile, setProfile] = useState('我的订阅')
  const [theme, setTheme] = useState('dark')
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const group = groups.find(
    (item) => item.id === (mode === 'global' ? 'global' : groupId),
  )!
  const updateGroup = (patch: Partial<QuickGroup>) =>
    setGroups((current) =>
      current.map((item) =>
        item.id === group.id ? { ...item, ...patch } : item,
      ),
    )

  return (
    <main
      className={`qp-preview${nativePreview ? ' qp-live' : ''}`}
      data-theme={theme}
    >
      {!nativePreview && (
        <div className="qp-preview-toolbar">
          <span>交互预览 · 模拟数据</span>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '浅色外观' : '深色外观'}
          </button>
        </div>
      )}
      <QuickPanel
        key={`${profile}:${group.id}`}
        testing={testing}
        onTest={() => {
          if (testing) return
          setTesting(true)
          const testedGroup = group
          updateGroup({
            nodes: group.nodes.map((node) =>
              group.favorites.includes(node.id) ? { ...node, delay: -2 } : node,
            ),
          })
          setTimeout(() => {
            setGroups((current) =>
              current.map((item) =>
                item.id === testedGroup.id
                  ? {
                      ...item,
                      nodes: item.nodes.map((node) =>
                        testedGroup.favorites.includes(node.id)
                          ? {
                              ...node,
                              delay: node.id.startsWith('sg')
                                ? 0
                                : node.id.startsWith('jp')
                                  ? 76
                                  : 38,
                            }
                          : node,
                      ),
                    }
                  : item,
              ),
            )
            setTesting(false)
            setNotice(
              '模拟测速完成：新加坡节点演示超时；正式版使用真实检测结果。',
            )
          }, 1200)
        }}
        systemProxy={systemProxy}
        tun={tun}
        mode={mode}
        group={group}
        groups={
          mode === 'global'
            ? [group]
            : groups.filter((item) => item.id !== 'global')
        }
        profile={profile}
        profiles={['我的订阅', '备用订阅'].map((name) => ({ id: name, name }))}
        download="2.4 MB/s"
        upload="128 KB/s"
        onSystemProxy={() => setSystemProxy(!systemProxy)}
        onTun={() => setTun(!tun)}
        onMode={setMode}
        onGroup={setGroupId}
        onNode={(id) => updateGroup({ selected: id })}
        onFavorites={(favorites) => updateGroup({ favorites })}
        onProfile={(value) => {
          setProfile(value)
          setNotice('订阅选择仅用于预览，节点数据为示例。')
        }}
        onDashboard={() => setNotice('正式版本将在这里打开完整仪表盘。')}
        onSettings={() => setNotice('正式版本将在这里打开应用设置。')}
        onQuit={() => setNotice('这里只是模拟预览；正式版会退出 Clash Verge。')}
      />
      {!nativePreview && (
        <p className="qp-preview-note" role="status">
          {notice || '可以试试切换节点、编辑常用项、切换模式与外观。'}
        </p>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
