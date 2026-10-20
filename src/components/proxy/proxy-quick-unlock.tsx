import {
  Box,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  Popover,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import React, { useEffect, useState } from 'react'

import { normalizeUnlockName, useQuickUnlock } from '@/hooks/use-quick-unlock'

interface Props {
  groupName?: string
  proxyName: string
  selected?: boolean
}

const lastActiveByGroup: Record<string, string> = {}

export const ProxyQuickUnlock = ({
  groupName = 'default',
  proxyName,
  selected,
}: Props) => {
  const theme = useTheme()
  const {
    pinnedTargets,
    availableTargets,
    results,
    isTesting,
    isPinned,
    toggleTarget,
    runQuickUnlock,
  } = useQuickUnlock(proxyName)

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const isSelected = Boolean(selected)

  // Automatically test current node when switched
  useEffect(() => {
    if (!isSelected) return

    const previousActive = lastActiveByGroup[groupName]
    lastActiveByGroup[groupName] = proxyName

    // Delay 350ms to allow core routing to settle before testing new active node
    if (previousActive && previousActive !== proxyName) {
      if (pinnedTargets.length === 0) return
      const timer = setTimeout(() => {
        void runQuickUnlock(undefined, proxyName)
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [groupName, isSelected, pinnedTargets.length, proxyName, runQuickUnlock])

  // Only render on the selected active node
  if (!selected) {
    return null
  }

  const handleLeftClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (pinnedTargets.length === 0) {
      setAnchorEl(e.currentTarget as HTMLElement)
      return
    }

    if (!isTesting) {
      void runQuickUnlock(undefined, proxyName)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setAnchorEl(e.currentTarget as HTMLElement)
  }

  const handleClosePopover = () => {
    setAnchorEl(null)
  }

  const getStatusColor = (status?: string) => {
    if (!status) return theme.palette.text.secondary
    if (status === 'Yes') return theme.palette.success.main
    if (status === 'No') return theme.palette.error.main
    if (status === 'Originals Only' || status === 'Soon')
      return theme.palette.warning.main
    if (status.includes('Failed')) return theme.palette.error.main
    return theme.palette.text.secondary
  }

  const getStatusBgColor = (status?: string) => {
    const isDark = theme.palette.mode === 'dark'
    if (!status)
      return isDark
        ? alpha(theme.palette.text.primary, 0.08)
        : alpha(theme.palette.text.primary, 0.05)
    if (status === 'Yes')
      return isDark
        ? alpha(theme.palette.success.main, 0.2)
        : alpha(theme.palette.success.main, 0.12)
    if (status === 'No')
      return isDark
        ? alpha(theme.palette.error.main, 0.2)
        : alpha(theme.palette.error.main, 0.12)
    if (status === 'Originals Only' || status === 'Soon')
      return isDark
        ? alpha(theme.palette.warning.main, 0.2)
        : alpha(theme.palette.warning.main, 0.12)
    if (status.includes('Failed'))
      return isDark
        ? alpha(theme.palette.error.main, 0.2)
        : alpha(theme.palette.error.main, 0.12)
    return isDark
      ? alpha(theme.palette.text.primary, 0.08)
      : alpha(theme.palette.text.primary, 0.05)
  }

  const formatTargetSummary = (target: string) => {
    const res = results[normalizeUnlockName(target)]
    if (!res) {
      return {
        label: target,
        tooltip: `${target}: 未检测（左键点击测试，右键配置关注站点）`,
        status: undefined,
      }
    }
    const regionStr = res.region ? ` ${res.region}` : ''
    const timeStr = res.check_time ? ` (${res.check_time})` : ''
    const statusText =
      res.status === 'Yes'
        ? '解锁'
        : res.status === 'No'
          ? '未解锁'
          : res.status
    return {
      label: `${target}: ${statusText}${regionStr}`,
      tooltip: `${target}: ${res.status}${regionStr}${timeStr}（左键重新测试，右键配置）`,
      status: res.status,
    }
  }

  return (
    <>
      <Box
        onClick={handleLeftClick}
        onContextMenu={handleContextMenu}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'pointer',
          userSelect: 'none',
          mr: 0.5,
          verticalAlign: 'middle',
        }}
      >
        {isTesting ? (
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '11px',
              lineHeight: 1.2,
              backgroundColor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
            }}
          >
            <CircularProgress size={10} color="inherit" />
            <span>检测中...</span>
          </Box>
        ) : pinnedTargets.length === 0 ? (
          <Tooltip title="点击配置关注的解锁测试站点（右键亦可）">
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                lineHeight: 1.2,
                border: `1px dashed ${alpha(theme.palette.text.secondary, 0.3)}`,
                color: theme.palette.text.secondary,
                '&:hover': {
                  borderColor: theme.palette.primary.main,
                  color: theme.palette.primary.main,
                },
              }}
            >
              + 测解锁
            </Box>
          </Tooltip>
        ) : (
          pinnedTargets.map((target) => {
            const summary = formatTargetSummary(target)
            return (
              <Tooltip key={target} title={summary.tooltip} arrow>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    lineHeight: 1.2,
                    fontWeight: 500,
                    backgroundColor: getStatusBgColor(summary.status),
                    color: getStatusColor(summary.status),
                    transition: 'all 0.15s ease',
                    '&:hover': {
                      filter: 'brightness(1.1)',
                      boxShadow: `0 0 0 1px ${getStatusColor(summary.status)}`,
                    },
                  }}
                >
                  {summary.label}
                </Box>
              </Tooltip>
            )
          })
        )}
      </Box>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClosePopover}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        onClick={(e) => e.stopPropagation()}
        slotProps={{
          paper: {
            sx: {
              p: 1.5,
              width: 220,
              maxHeight: 320,
              borderRadius: 2,
              boxShadow: 4,
            },
          },
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 600, mb: 0.5, color: 'text.primary' }}
        >
          关注的解锁站点
        </Typography>
        <Typography
          variant="caption"
          sx={{ display: 'block', mb: 1, color: 'text.secondary' }}
        >
          勾选 1~2 个在节点后快速检测
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
          {availableTargets.length === 0 ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              加载站点列表中...
            </Typography>
          ) : (
            availableTargets.map((name) => {
              const checked = isPinned(name)
              return (
                <FormControlLabel
                  key={name}
                  control={
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={() => toggleTarget(name)}
                      sx={{ p: 0.5 }}
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                      {name}
                    </Typography>
                  }
                  sx={{ ml: 0, mr: 0 }}
                />
              )
            })
          )}
        </Box>
      </Popover>
    </>
  )
}
