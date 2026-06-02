import {
  AccessTimeRounded,
  BoltRounded,
  MyLocationRounded,
  NetworkCheckRounded,
  FilterAltRounded,
  FilterAltOffRounded,
  SpeedRounded,
  StopCircleRounded,
  VisibilityRounded,
  VisibilityOffRounded,
  WifiTetheringRounded,
  WifiTetheringOffRounded,
  SortByAlphaRounded,
  SortRounded,
} from '@mui/icons-material'
import { Box, IconButton, TextField, SxProps } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSearchBox } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import delayManager from '@/services/delay'
import { debugLog } from '@/utils/debug'

import type { ProxySortType } from './use-filter-sort'
import type { HeadState } from './use-head-state'

interface Props {
  sx?: SxProps
  url?: string
  groupName: string
  headState: HeadState
  onLocation: () => void
  onCheckDelay: () => void
  onCheckSpeed: () => void
  onCheckBoth: () => void
  onCancelTests: () => void
  onHeadState: (val: Partial<HeadState>) => void
}

const defaultSx: SxProps = {}

export const ProxyHead = ({
  sx = defaultSx,
  url,
  groupName,
  headState,
  onHeadState,
  onLocation,
  onCheckDelay,
  onCheckSpeed,
  onCheckBoth,
  onCancelTests,
}: Props) => {
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
  const [autoFocus, setAutoFocus] = useState(false)

  useEffect(() => {
    // fix the focus conflict
    const timer = setTimeout(() => setAutoFocus(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const { verge } = useVerge()
  const defaultLatencyUrl =
    verge?.default_latency_test?.trim() ||
    'http://cp.cloudflare.com/generate_204'

  useEffect(() => {
    delayManager.setUrl(groupName, testUrl?.trim() || url || defaultLatencyUrl)
  }, [groupName, testUrl, defaultLatencyUrl, url])

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...sx }}>
      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.locate')}
        onClick={onLocation}
      >
        <MyLocationRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.delayCheck')}
        onClick={() => {
          debugLog(`[ProxyHead] 点击延迟测试按钮，组: ${groupName}`)
          // Remind the user that it is custom test url
          if (testUrl?.trim() && textState !== 'filter') {
            debugLog(`[ProxyHead] 使用自定义测试URL: ${testUrl}`)
            onHeadState({ textState: 'url' })
          }
          onCheckDelay()
        }}
      >
        <NetworkCheckRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title="下载测速"
        onClick={onCheckSpeed}
      >
        <SpeedRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title="延迟 + 下载测速"
        onClick={onCheckBoth}
      >
        <BoltRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title="中断所有测试"
        onClick={onCancelTests}
      >
        <StopCircleRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={
          [
            t('proxies.page.tooltips.sortDefault'),
            t('proxies.page.tooltips.sortDelay'),
            t('proxies.page.tooltips.sortName'),
            '按速度排序',
            '最佳性价比排序',
          ][sortType]
        }
        onClick={() =>
          onHeadState({ sortType: ((sortType + 1) % 5) as ProxySortType })
        }
      >
        {sortType === 0 && <SortRounded />}
        {sortType === 1 && <AccessTimeRounded />}
        {sortType === 2 && <SortByAlphaRounded />}
        {sortType === 3 && <SpeedRounded />}
        {sortType === 4 && <BoltRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.delayCheckUrl')}
        onClick={() =>
          onHeadState({ textState: textState === 'url' ? null : 'url' })
        }
      >
        {textState === 'url' ? (
          <WifiTetheringRounded />
        ) : (
          <WifiTetheringOffRounded />
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
        onClick={() => onHeadState({ showType: !showType })}
      >
        {showType ? <VisibilityRounded /> : <VisibilityOffRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.filter')}
        onClick={() =>
          onHeadState({ textState: textState === 'filter' ? null : 'filter' })
        }
      >
        {textState === 'filter' ? (
          <FilterAltRounded />
        ) : (
          <FilterAltOffRounded />
        )}
      </IconButton>

      {textState === 'filter' && (
        <Box sx={{ ml: 0.5, flex: '1 1 auto' }}>
          <BaseSearchBox
            autoFocus={autoFocus}
            value={filterText}
            searchState={{
              matchCase: filterMatchCase,
              matchWholeWord: filterMatchWholeWord,
              useRegularExpression: filterUseRegularExpression,
            }}
            onSearch={(_, state) =>
              onHeadState({
                filterText: state.text,
                filterMatchCase: state.matchCase,
                filterMatchWholeWord: state.matchWholeWord,
                filterUseRegularExpression: state.useRegularExpression,
              })
            }
          />
        </Box>
      )}

      {textState === 'url' && (
        <TextField
          autoComplete="new-password"
          autoFocus={autoFocus}
          hiddenLabel
          autoSave="off"
          value={testUrl}
          size="small"
          variant="outlined"
          placeholder={t('proxies.page.placeholders.delayCheckUrl')}
          onChange={(e) => onHeadState({ testUrl: e.target.value })}
          sx={{ ml: 0.5, flex: '1 1 auto', input: { py: 0.65, px: 1 } }}
        />
      )}
    </Box>
  )
}
