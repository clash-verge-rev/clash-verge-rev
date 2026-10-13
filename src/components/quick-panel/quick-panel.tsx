import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import { useState } from 'react'

import logo from '@/assets/image/icon_light.svg'
import enLabels from '@/locales/en/quickPanel.json'
import zhLabels from '@/locales/zh/quickPanel.json'

import './quick-panel.css'

export interface QuickNode {
  id: string
  name: string
  region: string
  delay: number | null
  available?: boolean
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
  language?: string
  systemProxy: boolean
  tun: boolean
  mode: QuickMode
  group: QuickGroup
  groups: QuickGroup[]
  profile: string
  profiles: { id: string; name: string }[]
  tunUnavailable?: string
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
  language = 'zh',
  systemProxy,
  tun,
  mode,
  group,
  groups,
  profile,
  profiles,
  tunUnavailable,
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
  const labels = language === 'zh' ? zhLabels : enLabels
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
    <section className="quick-panel" aria-label={labels.panel}>
      <header className="qp-header">
        <div className="qp-brand">
          <img src={logo} alt="" />
          <strong>Clash Verge</strong>
        </div>
        <button
          className="qp-icon"
          aria-label={labels.settings}
          onClick={onSettings}
        >
          <SettingsOutlined />
        </button>
      </header>

      <div className="qp-controls">
        <div className="qp-control">
          <div>
            <strong>{labels.systemProxy}</strong>
            <span>{labels.systemHint}</span>
          </div>
          <button
            className="qp-switch"
            role="switch"
            aria-label={labels.systemProxy}
            aria-checked={systemProxy}
            onClick={onSystemProxy}
          >
            <span />
          </button>
        </div>
        <div className="qp-control">
          <div>
            <strong>{labels.tun}</strong>
            <span>{tunUnavailable || labels.tunHint}</span>
          </div>
          <button
            className="qp-switch"
            role="switch"
            aria-label={labels.tun}
            aria-checked={tun}
            disabled={!!tunUnavailable && !tun}
            onClick={onTun}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="qp-modes" role="group" aria-label={labels.mode}>
        {(['rule', 'global', 'direct'] as const).map((optionMode, index) => (
          <button
            key={optionMode}
            aria-pressed={mode === optionMode}
            onClick={() => onMode(optionMode)}
          >
            {[labels.rule, labels.global, labels.direct][index]}
          </button>
        ))}
      </div>

      <div className="qp-section-heading">
        <h2>{labels.favorites}</h2>
        <button
          className="qp-text"
          aria-expanded={editing}
          onClick={() => {
            setEditing(!editing)
            setShowAll(false)
          }}
        >
          {editing ? labels.done : labels.edit}
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
              disabled={direct || node.available === false}
              title={node.name}
              onClick={() => onNode(node.id)}
            >
              <span className="qp-region">
                <LocationOnOutlined />
                {node.region || labels.node}
              </span>
              <strong>{node.name}</strong>
              <span className="qp-delay">
                {node.available === false
                  ? labels.unavailable
                  : node.delay === null
                    ? labels.untested
                    : `${node.delay} ms`}
              </span>
              <span className="qp-selected">
                {active ? (
                  <>
                    <CheckRounded />
                    {labels.selected}
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
              <span>＋</span>
              {labels.addFavorite}
            </button>
          )
        })}
      </div>

      <div className="qp-current" aria-live="polite">
        {direct
          ? labels.directHint
          : `${labels.current}${selected?.name ?? labels.noNode}`}
      </div>
      <div className="qp-group-row">
        <label>
          {labels.group}：
          <select
            aria-label={labels.group}
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
          {labels.allNodes} <ArrowOutwardRounded />
        </button>
      </div>

      {(editing || showAll) && (
        <section
          className="qp-picker"
          aria-label={editing ? labels.editFavorites : labels.allNodes}
        >
          <div className="qp-picker-heading">
            <strong>
              {editing
                ? `${labels.chooseFavorites} (${group.favorites.length}/3)`
                : labels.allNodes}
            </strong>
            <button
              className="qp-icon"
              aria-label={labels.collapse}
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
            placeholder={labels.search}
            aria-label={labels.search}
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
                        (group.favorites.length === 3 ||
                          node.available === false)
                      : direct || node.available === false
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
                    {node.available === false
                      ? labels.unavailable
                      : node.delay === null
                        ? labels.untested
                        : `${node.delay} ms`}
                  </span>
                  {(editing
                    ? group.favorites.includes(node.id)
                    : group.selected === node.id) && <CheckRounded />}
                </button>
              ))}
            {!group.nodes.some((node) =>
              node.name.toLowerCase().includes(search.toLowerCase()),
            ) && <p>{labels.noMatch}</p>}
          </div>
          {editing && <p className="qp-hint">{labels.replaceHint}</p>}
        </section>
      )}

      <div className="qp-traffic">
        <div>
          <ArrowDownwardRounded />
          <span>
            <strong>{download}</strong>
            <small>{labels.download}</small>
          </span>
        </div>
        <div>
          <ArrowUpwardRounded />
          <span>
            <strong>{upload}</strong>
            <small>{labels.upload}</small>
          </span>
        </div>
      </div>
      <footer className="qp-footer">
        <select
          aria-label={labels.profile}
          value={profile}
          onChange={(event) => onProfile(event.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button className="qp-text" onClick={onDashboard}>
          {labels.dashboard} <ArrowOutwardRounded />
        </button>
      </footer>
    </section>
  )
}
