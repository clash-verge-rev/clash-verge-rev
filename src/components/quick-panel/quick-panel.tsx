import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import { useState } from 'react'

import logo from '@/assets/image/logo.ico'

import './quick-panel.css'

export interface QuickNode {
  id: string
  name: string
  region: string
  delay: number | null
}

export interface QuickGroup {
  id: string
  name: string
  nodes: QuickNode[]
  selected: string
  favorites: string[]
}

export type QuickMode = 'rule' | 'global' | 'direct'

interface Props {
  systemProxy: boolean
  tun: boolean
  mode: QuickMode
  group: QuickGroup
  groups: QuickGroup[]
  profile: string
  profiles: string[]
  download: string
  upload: string
  onSystemProxy: () => void
  onTun: () => void
  onMode: (mode: QuickMode) => void
  onGroup: (id: string) => void
  onNode: (id: string) => void
  onFavorites: (ids: string[]) => void
  onProfile: (profile: string) => void
  onDashboard: () => void
  onSettings: () => void
}

export function QuickPanel({
  systemProxy,
  tun,
  mode,
  group,
  groups,
  profile,
  profiles,
  download,
  upload,
  onSystemProxy,
  onTun,
  onMode,
  onGroup,
  onNode,
  onFavorites,
  onProfile,
  onDashboard,
  onSettings,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const selected = group.nodes.find((node) => node.id === group.selected)
  const nodes = group.favorites.map((id) =>
    group.nodes.find((node) => node.id === id),
  )
  const direct = mode === 'direct'

  const toggleFavorite = (id: string) => {
    const ids = group.favorites.includes(id)
      ? group.favorites.filter((favorite) => favorite !== id)
      : [...group.favorites, id]
    if (ids.length <= 3) onFavorites(ids)
  }

  return (
    <section className="quick-panel" aria-label="Clash Verge 快捷面板">
      <header className="qp-header">
        <div className="qp-brand">
          <img src={logo} alt="" />
          <strong>Clash Verge</strong>
        </div>
        <button className="qp-icon" aria-label="打开设置" onClick={onSettings}>
          <SettingsOutlined />
        </button>
      </header>

      <div className="qp-controls">
        <div className="qp-control">
          <div>
            <strong>系统代理</strong>
            <span>接管系统网络</span>
          </div>
          <button
            className="qp-switch"
            role="switch"
            aria-label="系统代理"
            aria-checked={systemProxy}
            onClick={onSystemProxy}
          >
            <span />
          </button>
        </div>
        <div className="qp-control">
          <div>
            <strong>TUN 模式</strong>
            <span>接管更多应用流量</span>
          </div>
          <button
            className="qp-switch"
            role="switch"
            aria-label="TUN 模式"
            aria-checked={tun}
            onClick={onTun}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="qp-modes" role="group" aria-label="出站模式">
        {(['rule', 'global', 'direct'] as const).map((optionMode, index) => (
          <button
            key={optionMode}
            aria-pressed={mode === optionMode}
            onClick={() => onMode(optionMode)}
          >
            {['规则', '全局', '直连'][index]}
          </button>
        ))}
      </div>

      <div className="qp-section-heading">
        <h2>常用节点</h2>
        <button
          className="qp-text"
          aria-expanded={editing}
          onClick={() => {
            setEditing(!editing)
            setShowAll(false)
          }}
        >
          {editing ? '完成' : '编辑'}
        </button>
      </div>
      <div className="qp-tiles">
        {[0, 1, 2].map((index) => {
          const node = nodes[index]
          const active = !direct && node?.id === group.selected
          return node ? (
            <button
              className="qp-tile"
              key={node.id}
              aria-pressed={active}
              disabled={direct}
              title={node.name}
              onClick={() => onNode(node.id)}
            >
              <span className="qp-region">
                <LocationOnOutlined />
                {node.region}
              </span>
              <strong>{node.name}</strong>
              <span className="qp-delay">
                {node.delay === null ? '未测速' : `${node.delay} ms`}
              </span>
              <span className="qp-selected">
                {active ? (
                  <>
                    <CheckRounded />
                    使用中
                  </>
                ) : (
                  '\u00a0'
                )}
              </span>
            </button>
          ) : (
            <button
              className="qp-tile qp-empty"
              key={`empty-${index}`}
              onClick={() => setEditing(true)}
            >
              <span>＋</span>添加常用节点
            </button>
          )
        })}
      </div>

      <div className="qp-current" aria-live="polite">
        {direct
          ? '直连模式 · 流量直接访问网络'
          : `当前：${selected?.name ?? '未选择节点'}`}
      </div>
      <div className="qp-group-row">
        <label>
          代理组：
          <select
            aria-label="代理组"
            value={group.id}
            disabled={mode !== 'rule'}
            onChange={(event) => {
              onGroup(event.target.value)
              setSearch('')
            }}
          >
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="qp-text"
          aria-expanded={showAll}
          onClick={() => {
            setShowAll(!showAll)
            setEditing(false)
          }}
        >
          全部节点 <ArrowOutwardRounded />
        </button>
      </div>

      {(editing || showAll) && (
        <section
          className="qp-picker"
          aria-label={editing ? '编辑常用节点' : '全部节点'}
        >
          <div className="qp-picker-heading">
            <strong>
              {editing
                ? `选择常用节点（${group.favorites.length}/3）`
                : '全部节点'}
            </strong>
            <button
              className="qp-icon"
              aria-label="收起节点选择"
              onClick={() => {
                setEditing(false)
                setShowAll(false)
              }}
            >
              <CloseRounded />
            </button>
          </div>
          <input
            type="search"
            placeholder="搜索节点"
            aria-label="搜索节点"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="qp-node-options">
            {group.nodes
              .filter((node) =>
                node.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((node) => (
                <button
                  key={node.id}
                  disabled={
                    editing
                      ? !group.favorites.includes(node.id) &&
                        group.favorites.length === 3
                      : direct
                  }
                  aria-pressed={
                    editing
                      ? group.favorites.includes(node.id)
                      : group.selected === node.id
                  }
                  onClick={() =>
                    editing ? toggleFavorite(node.id) : onNode(node.id)
                  }
                >
                  <span>{node.name}</span>
                  <span>
                    {node.delay === null ? '未测速' : `${node.delay} ms`}
                  </span>
                  {(editing
                    ? group.favorites.includes(node.id)
                    : group.selected === node.id) && <CheckRounded />}
                </button>
              ))}
            {!group.nodes.some((node) =>
              node.name.toLowerCase().includes(search.toLowerCase()),
            ) && <p>没有匹配的节点</p>}
          </div>
          {editing && (
            <p className="qp-hint">先取消一个常用节点，再添加新节点。</p>
          )}
        </section>
      )}

      <div className="qp-traffic">
        <div>
          <ArrowDownwardRounded />
          <span>
            <strong>{download}</strong>
            <small>下载</small>
          </span>
        </div>
        <div>
          <ArrowUpwardRounded />
          <span>
            <strong>{upload}</strong>
            <small>上传</small>
          </span>
        </div>
      </div>
      <footer className="qp-footer">
        <select
          aria-label="当前订阅"
          value={profile}
          onChange={(event) => onProfile(event.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile}>{profile}</option>
          ))}
        </select>
        <button className="qp-text" onClick={onDashboard}>
          完整仪表盘 <ArrowOutwardRounded />
        </button>
      </footer>
    </section>
  )
}
