import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded'
import FilterAltOffRounded from '@mui/icons-material/FilterAltOffRounded'
import FilterAltRounded from '@mui/icons-material/FilterAltRounded'
import MyLocationRounded from '@mui/icons-material/MyLocationRounded'
import NetworkCheckRounded from '@mui/icons-material/NetworkCheckRounded'
import SortByAlphaRounded from '@mui/icons-material/SortByAlphaRounded'
import SortRounded from '@mui/icons-material/SortRounded'
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRounded from '@mui/icons-material/VisibilityRounded'
import WifiTetheringOffRounded from '@mui/icons-material/WifiTetheringOffRounded'
import WifiTetheringRounded from '@mui/icons-material/WifiTetheringRounded'
import { Box, IconButton, type SxProps, TextField } from '@mui/material'
import { useDebounceFn } from 'ahooks'
import { memo, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { useVerge } from '@/hooks/use-verge'
import delayManager from '@/services/delay'

import { BaseSearchBox, type SearchState } from '../base'

import type { ProxySortType } from './use-filter-sort'
import type { HeadState } from './use-head-state'

interface Props {
  sx?: SxProps
  url?: string
  groupName: string
  headState: HeadState
  onLocation: () => void
  onCheckDelay: () => void
  onHeadState: (val: Partial<HeadState>) => void
}

export const ProxyGroupTools = memo(function ProxyGroupTools(props: Props) {
  const {
    sx,
    url,
    groupName,
    headState,
    onCheckDelay,
    onHeadState,
    onLocation,
  } = props

  const {
    showType,
    sortType,
    filterText,
    textState,
    testUrl,
    filterMatchCase,
    filterMatchWholeWord,
    filterUseRegularExpression,
  } = headState

  const { t } = useTranslation()

  const { verge } = useVerge()
  const defaultLatencyUrl =
    verge?.default_latency_test?.trim() ||
    'http://cp.cloudflare.com/generate_204'

  useEffect(() => {
    delayManager.setUrl(groupName, testUrl?.trim() || url || defaultLatencyUrl)
  }, [groupName, testUrl, defaultLatencyUrl, url])

  // 过滤输入是高频操作，且每次都会触发整组代理的重新过滤/排序与虚拟列表重渲染，
  // 因此对写入 headState 的动作做防抖，避免每输入一个字符就过滤一次。
  const { run: applyFilter, flush: flushFilter } = useDebounceFn(
    (state: SearchState) => {
      onHeadState({
        filterText: state.text,
        filterMatchCase: state.matchCase,
        filterMatchWholeWord: state.matchWholeWord,
        filterUseRegularExpression: state.useRegularExpression,
      })
    },
    { wait: 600 },
  )

  // 关闭过滤框或卸载时立即应用最后一次输入，避免丢失未生效的过滤条件。
  useEffect(() => {
    if (textState !== 'filter') flushFilter()
  }, [textState, flushFilter])
  useEffect(() => () => flushFilter(), [flushFilter])

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'end',
        alignItems: 'center',
        gap: 0.5,
        height: 36,
        flex: 1,
        ml: 2,
        ...sx,
      }}
    >
      {textState === 'filter' && (
        <Box sx={{ flex: '1 1 auto' }}>
          <BaseSearchBox
            defaultValue={filterText}
            matchCase={filterMatchCase}
            matchWholeWord={filterMatchWholeWord}
            useRegularExpression={filterUseRegularExpression}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onSearch={(_, state) => applyFilter(state)}
          />
        </Box>
      )}

      {textState === 'url' && (
        <TextField
          autoComplete="new-password"
          hiddenLabel
          autoSave="off"
          value={testUrl}
          size="small"
          variant="outlined"
          placeholder={t('proxies.page.placeholders.delayCheckUrl')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onChange={(e) => onHeadState({ testUrl: e.target.value })}
          sx={{ flex: '1 1 auto', input: { py: 0.65, px: 1 } }}
        />
      )}
      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.locate')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!headState.open)
            // eslint-disable-next-line @eslint-react/dom-no-flush-sync
            flushSync(() => onHeadState({ open: true }))
          onLocation()
        }}
      >
        <MyLocationRounded fontSize="inherit" />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.delayCheck')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!headState.open)
            // eslint-disable-next-line @eslint-react/dom-no-flush-sync
            flushSync(() => onHeadState({ open: true }))
          // Remind the user that it is custom test url
          if (testUrl?.trim() && textState !== 'filter') {
            onHeadState({ textState: 'url' })
          }
          onCheckDelay()
        }}
      >
        <NetworkCheckRounded fontSize="inherit" />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={
          [
            t('proxies.page.tooltips.sortDefault'),
            t('proxies.page.tooltips.sortDelay'),
            t('proxies.page.tooltips.sortName'),
          ][sortType]
        }
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!headState.open)
            // eslint-disable-next-line @eslint-react/dom-no-flush-sync
            flushSync(() => onHeadState({ open: true }))
          onHeadState({
            sortType: ((sortType + 1) % 3) as ProxySortType,
          })
        }}
      >
        {sortType !== 1 && sortType !== 2 && <SortRounded fontSize="inherit" />}
        {sortType === 1 && <AccessTimeRounded fontSize="inherit" />}
        {sortType === 2 && <SortByAlphaRounded fontSize="inherit" />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.delayCheckUrl')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onHeadState({
            textState: textState === 'url' ? null : 'url',
          })
        }}
      >
        {textState === 'url' ? (
          <WifiTetheringRounded fontSize="inherit" />
        ) : (
          <WifiTetheringOffRounded fontSize="inherit" />
        )}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={
          showType
            ? t('proxies.page.tooltips.showBasic')
            : t('proxies.page.tooltips.showDetail')
        }
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!headState.open)
            // eslint-disable-next-line @eslint-react/dom-no-flush-sync
            flushSync(() => onHeadState({ open: true }))
          onHeadState({ showType: !showType })
        }}
      >
        {showType ? (
          <VisibilityRounded fontSize="inherit" />
        ) : (
          <VisibilityOffRounded fontSize="inherit" />
        )}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.filter')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!headState.open && textState !== 'filter')
            // eslint-disable-next-line @eslint-react/dom-no-flush-sync
            flushSync(() => onHeadState({ open: true }))
          onHeadState({ textState: textState === 'filter' ? null : 'filter' })
        }}
      >
        {textState === 'filter' ? (
          <FilterAltRounded fontSize="inherit" />
        ) : (
          <FilterAltOffRounded fontSize="inherit" />
        )}
      </IconButton>
    </Box>
  )
})
