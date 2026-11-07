import { CloseRounded } from '@mui/icons-material'
import {
  GlobalStyles,
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import getSystem from '@/utils/get-system'

import { searchSettings, type SettingEntry } from './settings-catalog'
import {
  SettingsSearchContext,
  type SearchDialog,
} from './settings-search-context'

export function SettingsSearch({
  children,
}: {
  children: (
    header: ReactNode,
    results: ReactNode,
    hidden: boolean,
  ) => ReactNode
}) {
  const { t } = useTranslation()
  const [registry] = useState(() => new Set<SearchDialog>())
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [showPage, setShowPage] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const originalScrollRef = useRef(0)
  const resultScrollRef = useRef(0)
  const cancelLocateRef = useRef<() => void>(() => {})
  const results = searchSettings(
    query,
    getSystem(),
    (key) => t(key),
    (key) => t(key, { lng: 'en' }),
  )
  const searching = !!query.trim()
  const scroller = () =>
    rootRef.current?.querySelector('.base-container > section')
  const restoreResults = () => {
    cancelLocateRef.current()
    setShowPage(false)
    requestAnimationFrame(() => {
      scroller()?.scrollTo({ top: resultScrollRef.current })
      inputRef.current?.focus()
    })
  }
  const changeQuery = (value: string) => {
    cancelLocateRef.current()
    if (!searching && value.trim())
      originalScrollRef.current = scroller()?.scrollTop ?? 0
    setQuery(value)
    setSelected(0)
    setShowPage(false)
    resultScrollRef.current = 0
    requestAnimationFrame(() =>
      scroller()?.scrollTo({
        top: value.trim() ? 0 : originalScrollRef.current,
      }),
    )
  }
  const locate = (entry: SettingEntry) => {
    cancelLocateRef.current()
    if (!showPage) resultScrollRef.current = scroller()?.scrollTop ?? 0
    if (entry.dialog) {
      const handles = [...registry].filter(
        (handle) => handle.id === entry.dialog,
      )
      ;(handles.find((handle) => handle.isOpen) ?? handles[0])?.open()
    } else setShowPage(true)
    let highlighted: HTMLElement | null = null
    let stopped = false
    let sawScope = false
    let temporaryTabIndex = false
    const cleanup = () => {
      stopped = true
      observer.disconnect()
      clearTimeout(timeout)
      highlighted?.removeAttribute('data-search-highlight')
      if (temporaryTabIndex) highlighted?.removeAttribute('tabindex')
    }
    const find = (timedOut = false) => {
      if (stopped) return
      const marker = entry.dialog
        ? [
            ...document.querySelectorAll(
              `[data-settings-dialog="${entry.dialog}"]`,
            ),
          ].find(
            (marker) =>
              marker.closest('[role="dialog"]')?.getClientRects().length,
          )
        : rootRef.current
      const scope = entry.dialog ? marker?.closest('[role="dialog"]') : marker
      if (!scope) {
        if (sawScope) {
          cleanup()
          inputRef.current?.focus()
        }
        return
      }
      if (highlighted) return
      sawScope = true
      const pending = marker?.getAttribute('data-search-ready') === 'false'
      if (pending && !timedOut) return
      let target = pending
        ? (scope.querySelector<HTMLElement>('[data-settings-loading]') ??
          (marker instanceof HTMLElement ? marker : null))
        : scope.querySelector<HTMLElement>(
            `[data-setting-target="${entry.target ?? entry.id}"]`,
          )
      const fields = target
        ? [
            ...target.querySelectorAll<HTMLElement>(
              'input,textarea,select,[role="combobox"]',
            ),
          ]
        : []
      const disabled =
        target?.matches(':disabled,[aria-disabled="true"]') ||
        (fields.length > 0 &&
          fields.every((field) =>
            field.matches(':disabled,[aria-disabled="true"]'),
          ))
      let fallback = pending
      if (!target || !target.getClientRects().length || disabled) {
        const fallbackId = disabled
          ? (entry.prerequisite ?? entry.fallback)
          : entry.fallback
        if (fallbackId) {
          target = scope.querySelector<HTMLElement>(
            `[data-setting-target="${fallbackId}"]`,
          )
          fallback = !disabled || !entry.prerequisite
        }
      }
      if (!target || !target.getClientRects().length) return
      highlighted = target
      target.setAttribute('data-search-highlight', 'true')
      target.scrollIntoView({ block: 'center' })
      const targetFocusable = target.matches(
        'button,input,textarea,select,a[href],[tabindex]',
      )
      const control =
        !fallback && !targetFocusable
          ? [
              ...target.querySelectorAll<HTMLElement>(
                'input:not(:disabled),textarea:not(:disabled),button:not(:disabled),[role="combobox"],a[href]',
              ),
            ].find(
              (element) =>
                element.getClientRects().length &&
                element.getAttribute('aria-disabled') !== 'true',
            )
          : null
      temporaryTabIndex = !control && !targetFocusable
      if (temporaryTabIndex) target.tabIndex = -1
      ;(control ?? target).focus({ preventScroll: true })
    }
    const observer = new MutationObserver(() => find())
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-search-ready', 'disabled'],
    })
    const timeout = setTimeout(() => {
      if (!highlighted) {
        find(true)
        if (!highlighted) cleanup()
      }
    }, 5000)
    cancelLocateRef.current = cleanup
    requestAnimationFrame(() => find())
  }
  useEffect(() => () => cancelLocateRef.current(), [])
  const moveSelection = (
    from: number,
    direction: number,
    focusResult = false,
  ) => {
    const next = (from + direction + results.length) % results.length
    setSelected(next)
    const target = rootRef.current?.querySelector<HTMLElement>(
      `[data-search-result="${next}"]`,
    )
    if (focusResult) target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  }
  const header = (
    <Box
      sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <TextField
        inputRef={inputRef}
        size="small"
        label={t('settings.search.placeholder')}
        value={query}
        onChange={(e) => changeQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            if (showPage) restoreResults()
            else changeQuery('')
          }
          if (e.key === 'Enter' && results[selected]) {
            e.preventDefault()
            locate(results[selected])
          }
          if (
            (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
            results.length
          ) {
            e.preventDefault()
            moveSelection(selected, e.key === 'ArrowDown' ? 1 : -1)
          }
        }}
      />
      {searching && (
        <IconButton
          aria-label={t('settings.search.clear')}
          onClick={() => changeQuery('')}
        >
          <CloseRounded />
        </IconButton>
      )}
      {showPage && (
        <Button onClick={restoreResults}>{t('settings.search.back')}</Button>
      )}
    </Box>
  )
  const resultView =
    searching && !showPage ? (
      <List aria-label={t('settings.search.results')}>
        {results.length ? (
          results.map((entry, index) => (
            <ListItemButton
              key={entry.id}
              data-search-result={index}
              selected={selected === index}
              onFocus={() => setSelected(index)}
              onClick={() => {
                setSelected(index)
                locate(entry)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  moveSelection(index, e.key === 'ArrowDown' ? 1 : -1, true)
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  inputRef.current?.focus()
                }
              }}
            >
              <ListItemText
                primary={t(entry.name)}
                secondary={`${t(entry.section)} / ${t(entry.path)}`}
              />
            </ListItemButton>
          ))
        ) : (
          <Typography sx={{ p: 2 }}>{t('settings.search.empty')}</Typography>
        )}
      </List>
    ) : null
  return (
    <SettingsSearchContext value={registry}>
      <GlobalStyles
        styles={{
          '[data-search-highlight]': {
            outline: '2px solid #6b70e8',
            outlineOffset: -2,
          },
        }}
      />
      <Box
        ref={rootRef}
        onKeyDown={(e) => {
          if (
            e.key === 'Escape' &&
            showPage &&
            !(e.target as HTMLElement).closest('[role="dialog"]')
          ) {
            e.stopPropagation()
            restoreResults()
          }
        }}
        sx={{
          height: '100%',
          '& .base-page > header': {
            flex: '0 0 auto',
            minHeight: 58,
            flexWrap: 'wrap',
            gap: 1,
            py: 1,
          },
        }}
      >
        {children(header, resultView, searching && !showPage)}
      </Box>
    </SettingsSearchContext>
  )
}
