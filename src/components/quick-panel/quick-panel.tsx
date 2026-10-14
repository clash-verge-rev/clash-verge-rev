import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import { useEffect, useRef, useState } from 'react'

import logo from '@/assets/image/icon_light.svg'
import enLabels from '@/locales/en/quickPanel.json'
import zhLabels from '@/locales/zh/quickPanel.json'
import { classifyDelay, DEFAULT_DELAY_TIMEOUT } from '@/utils/delay'

import './quick-panel.css'

export interface QuickNode {
  id: string
  name: string
  region: string
  delay: number | null
  testable?: boolean
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
  mode: QuickMode | null
  disabled?: boolean
  busy?: boolean
  testing?: boolean
  delayTimeout?: number
  systemProxyDisabled?: boolean
  status?: string
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
  onQuit: () => void
  onTest: () => void
}

export function QuickPanel({
  language = 'zh',
  disabled = false,
  busy = false,
  testing = false,
  delayTimeout = DEFAULT_DELAY_TIMEOUT,
  systemProxyDisabled = disabled,
  status,
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
  onQuit,
  onTest,
}: Props) {
  const labels = language === 'zh' ? zhLabels : enLabels
  const [editing, setEditing] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [popup, setPopup] = useState<
    | { kind: 'picker'; slot: number }
    | { kind: 'menu'; slot: number; x: number; y: number }
    | null
  >(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const suppressMenu = (event: MouseEvent) => event.preventDefault()
    document.addEventListener('contextmenu', suppressMenu)
    return () => document.removeEventListener('contextmenu', suppressMenu)
  }, [])
  useEffect(() => {
    if (popup) {
      dialogRef.current?.showModal()
      if (popup.kind === 'picker')
        dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    } else dialogRef.current?.close()
  }, [popup])
  const [search, setSearch] = useState('')
  const selected = group.nodes.find((node) => node.id === group.selected)
  const nodes = group.favorites.map((id) =>
    group.nodes.find((node) => node.id === id),
  )
  const direct = mode === 'direct'
  const delayText = (node: QuickNode) => {
    if (node.available === false) return labels.unavailable
    switch (classifyDelay(node.delay ?? -1, delayTimeout)) {
      case 'untested':
        return labels.untested
      case 'testing':
        return labels.testing
      case 'timeout':
        return labels.timeout
      case 'error':
        return labels.testFailed
      case 'measured':
        return `${node.delay} ms`
    }
  }

  const chooseSlot = (slot: number) => {
    setSearch('')
    setPopup({ kind: 'picker', slot })
  }
  const replaceSlot = (slot: number, id: string) => {
    const ids = [...group.favorites]
    while (ids.length <= slot) ids.push('')
    ids[slot] = id
    onFavorites(ids)
    setPopup(null)
  }

  return (
    <section className="quick-panel" aria-label={labels.panel} aria-busy={busy}>
      <header className="qp-header">
        <div className="qp-brand">
          <img src={logo} alt="" />
          <div>
            <strong>Clash Verge</strong>
            {status && (
              <span className="qp-status" role="status">
                {status}
              </span>
            )}
          </div>
        </div>
        {busy && (
          <span className="qp-progress" role="status">
            <span className="qp-sr-only">{labels.applying}</span>
          </span>
        )}
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
            data-unavailable={systemProxyDisabled}
            disabled={busy || systemProxyDisabled}
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
            data-unavailable={disabled || (!!tunUnavailable && !tun)}
            disabled={busy || disabled || (!!tunUnavailable && !tun)}
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
            data-unavailable={disabled}
            disabled={busy || disabled}
            aria-pressed={mode === optionMode}
            onClick={() => onMode(optionMode)}
          >
            {[labels.rule, labels.global, labels.direct][index]}
          </button>
        ))}
      </div>

      <div className="qp-section-heading">
        <h2>{labels.favorites}</h2>
        <div className="qp-node-actions">
          <button
            className="qp-action qp-test"
            title={labels.testHint}
            aria-label={labels.testHint}
            aria-busy={testing}
            data-unavailable={
              disabled ||
              !nodes.some(
                (node) =>
                  node && node.available !== false && node.testable !== false,
              )
            }
            disabled={
              busy ||
              disabled ||
              testing ||
              !nodes.some(
                (node) =>
                  node && node.available !== false && node.testable !== false,
              )
            }
            onClick={onTest}
          >
            {testing ? labels.testing : labels.test}
          </button>
          <button
            className="qp-action"
            disabled={busy}
            aria-pressed={editing}
            onClick={() => {
              setEditing(!editing)
              setShowAll(false)
            }}
          >
            {editing ? labels.done : labels.edit}
          </button>
        </div>
      </div>
      <div className="qp-tiles">
        {[0, 1, 2].map((index) => {
          const node = nodes[index]
          const active = !direct && node?.id === group.selected
          return (
            <div
              className="qp-tile-wrap"
              key={index}
              onContextMenu={(event) => {
                event.preventDefault()
                if (!node || busy) return
                setPopup({
                  kind: 'menu',
                  slot: index,
                  x: Math.max(
                    8,
                    Math.min(event.clientX, window.innerWidth - 188),
                  ),
                  y: Math.max(
                    8,
                    Math.min(event.clientY, window.innerHeight - 104),
                  ),
                })
              }}
            >
              {node ? (
                <button
                  className="qp-tile"
                  key={node.id}
                  aria-pressed={active}
                  data-unavailable={
                    disabled || direct || node.available === false
                  }
                  disabled={
                    busy ||
                    (!editing &&
                      (disabled || direct || node.available === false))
                  }
                  title={node.name}
                  onClick={() =>
                    editing ? chooseSlot(index) : onNode(node.id)
                  }
                >
                  {editing && (
                    <span className="qp-card-edit">
                      <EditOutlined />
                    </span>
                  )}
                  <span className="qp-region">
                    <LocationOnOutlined />
                    {node.region || labels.node}
                  </span>
                  <strong>{node.name}</strong>
                  <span
                    className="qp-delay"
                    data-state={classifyDelay(node.delay ?? -1, delayTimeout)}
                    aria-live="polite"
                  >
                    {delayText(node)}
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
                  data-unavailable={disabled}
                  disabled={busy || disabled}
                  key={`empty-${index}`}
                  onClick={() => chooseSlot(index)}
                >
                  <span>＋</span>
                  {disabled ? labels.nodePending : labels.addFavorite}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div
        className="qp-current"
        aria-live="polite"
        title={direct ? labels.directHint : selected?.name}
      >
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
            data-unavailable={disabled || mode !== 'rule'}
            disabled={busy || disabled || mode !== 'rule'}
            onChange={(event) => {
              onGroup(event.target.value)
              setSearch('')
            }}
          >
            {!groups.length && <option value="">{group.name}</option>}
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="qp-text"
          data-unavailable={disabled}
          disabled={busy || disabled}
          aria-expanded={showAll}
          onClick={() => {
            setShowAll(!showAll)
            setEditing(false)
          }}
        >
          {labels.allNodes} <ArrowOutwardRounded />
        </button>
      </div>

      {showAll && (
        <section className="qp-picker" aria-label={labels.allNodes}>
          <div className="qp-picker-heading">
            <strong>{labels.allNodes}</strong>
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
                    busy || disabled || direct || node.available === false
                  }
                  aria-pressed={group.selected === node.id}
                  onClick={() => onNode(node.id)}
                >
                  <span>{node.name}</span>
                  <span>{delayText(node)}</span>
                  {group.selected === node.id && <CheckRounded />}
                </button>
              ))}
            {!group.nodes.some((node) =>
              node.name.toLowerCase().includes(search.toLowerCase()),
            ) && <p>{labels.noMatch}</p>}
          </div>
        </section>
      )}

      <dialog
        ref={dialogRef}
        className={`qp-dialog ${popup?.kind === 'menu' ? 'qp-context-menu' : 'qp-slot-picker'}`}
        aria-label={
          popup?.kind === 'menu'
            ? labels.favoriteActions
            : labels.chooseFavorites
        }
        style={
          popup?.kind === 'menu' ? { left: popup.x, top: popup.y } : undefined
        }
        onCancel={() => setPopup(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setPopup(null)
        }}
      >
        {popup?.kind === 'menu' ? (
          <div role="menu" aria-label={labels.favoriteActions}>
            <button
              role="menuitem"
              disabled={disabled}
              onClick={() => chooseSlot(popup.slot)}
            >
              {labels.replaceFavorite}
            </button>
            <button role="menuitem" onClick={() => replaceSlot(popup.slot, '')}>
              {labels.removeFavorite}
            </button>
          </div>
        ) : popup?.kind === 'picker' ? (
          <>
            <div className="qp-picker-heading">
              <strong>{labels.chooseFavorites}</strong>
              <button
                className="qp-icon"
                aria-label={labels.collapse}
                onClick={() => setPopup(null)}
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
                .filter(
                  (node) =>
                    node.available !== false &&
                    (!group.favorites.includes(node.id) ||
                      group.favorites[popup.slot] === node.id) &&
                    node.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((node) => (
                  <button
                    key={node.id}
                    disabled={busy || disabled}
                    aria-pressed={group.favorites[popup.slot] === node.id}
                    onClick={() => replaceSlot(popup.slot, node.id)}
                  >
                    <span>{node.name}</span>
                    <span>{delayText(node)}</span>
                    {group.favorites[popup.slot] === node.id && (
                      <CheckRounded />
                    )}
                  </button>
                ))}
              {!group.nodes.some(
                (node) =>
                  node.available !== false &&
                  (!group.favorites.includes(node.id) ||
                    group.favorites[popup.slot] === node.id) &&
                  node.name.toLowerCase().includes(search.toLowerCase()),
              ) && <p>{labels.noMatch}</p>}
            </div>
          </>
        ) : null}
      </dialog>

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
          data-unavailable={disabled}
          disabled={busy || disabled}
          value={profile}
          onChange={(event) => onProfile(event.target.value)}
        >
          {!profiles.length && <option value="">{labels.profile}</option>}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <div className="qp-footer-actions">
          <button className="qp-text" onClick={onDashboard}>
            {labels.dashboard} <ArrowOutwardRounded />
          </button>
          <button
            className="qp-text"
            aria-label={labels.quitApp}
            title={labels.quitApp}
            onClick={onQuit}
          >
            <LogoutRounded /> {labels.quit}
          </button>
        </div>
      </footer>
    </section>
  )
}
