/* eslint-disable @eslint-react/set-state-in-effect */
import {
  AccessTimeRounded,
  ChevronRight,
  NetworkCheckRounded,
  WifiOff as SignalError,
  SignalWifi3Bar as SignalGood,
  SignalWifi2Bar as SignalMedium,
  SignalWifi0Bar as SignalNone,
  SignalWifi4Bar as SignalStrong,
  SignalWifi1Bar as SignalWeak,
  SortByAlphaRounded,
  SortRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  ClickAwayListener,
  FormControl,
  IconButton,
  InputLabel,
  type MenuProps,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Select,
  type SelectChangeEvent,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { EnhancedCard } from '@/components/home/enhanced-card'
import type { ProxySortType } from '@/components/proxy/use-filter-sort'
import { useGroupDelays } from '@/hooks/use-group-delays'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useCoreDataStatus,
  useProxiesData,
} from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import {
  findCurrentGroupMember,
  getRecord,
  isInteractableMember,
  memberDetails,
  resolveMember,
  type ProxyGroupView,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'
import { compareByDelay, DEFAULT_DELAY_TIMEOUT } from '@/utils/delay'

const STORAGE_KEY_GROUP = 'clash-verge-selected-proxy-group'
const STORAGE_KEY_SORT_TYPE = 'clash-verge-proxy-sort-type'

const AUTO_CHECK_DEFAULT_INTERVAL_MINUTES = 5
const AUTO_CHECK_INITIAL_DELAY_MS = 100
const PROXY_MENU_MAX_HEIGHT = 500

interface ProxyOption {
  memberIndex: number
  member: ResolvedProxyMember
  value: string
  name: string
  disabled: boolean
}

type OpenSelect = 'group' | 'proxy' | null

function convertDelayColor(
  delayValue: number,
): 'success' | 'warning' | 'error' | 'primary' | 'default' {
  const colorStr = delayManager.formatDelayColor(delayValue)
  if (!colorStr) return 'default'

  const mainColor = colorStr.split('.')[0]

  switch (mainColor) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'primary':
      return 'primary'
    default:
      return 'default'
  }
}

function getSignalIcon(
  delay: number,
  translate: (key: string) => string,
): {
  icon: React.ReactElement
  text: string
  color: string
} {
  if (delay === -2)
    return {
      icon: <SignalNone />,
      text: translate('home.components.currentProxy.status.testing'),
      color: 'text.secondary',
    }
  if (delay === -1)
    return {
      icon: <SignalNone />,
      text: translate('home.components.currentProxy.status.untested'),
      color: 'text.secondary',
    }
  if (delay > 1e5)
    return {
      icon: <SignalError />,
      text: translate('home.components.currentProxy.status.error'),
      color: 'error.main',
    }
  if (delay === 0 || delay >= 10000)
    return {
      icon: <SignalError />,
      text: translate('home.components.currentProxy.status.timeout'),
      color: 'error.main',
    }
  if (delay >= 500)
    return {
      icon: <SignalWeak />,
      text: translate('home.components.currentProxy.status.latencyHigh'),
      color: 'error.main',
    }
  if (delay >= 300)
    return {
      icon: <SignalMedium />,
      text: translate('home.components.currentProxy.status.latencyMedium'),
      color: 'warning.main',
    }
  if (delay >= 200)
    return {
      icon: <SignalGood />,
      text: translate('home.components.currentProxy.status.latencyGood'),
      color: 'info.main',
    }
  return {
    icon: <SignalStrong />,
    text: translate('home.components.currentProxy.status.latencyExcellent'),
    color: 'success.main',
  }
}

const optionValue = (memberIndex: number, member: ResolvedProxyMember) =>
  `${memberIndex}:${
    member.kind === 'node' ? member.node.recordId : member.ref.name
  }`

const hasPointerCoordinates = (
  value: unknown,
): value is { clientX: number; clientY: number } =>
  typeof value === 'object' &&
  value !== null &&
  'clientX' in value &&
  typeof value.clientX === 'number' &&
  'clientY' in value &&
  typeof value.clientY === 'number'

const eventHitsElement = (event: unknown, element: HTMLElement | null) => {
  if (!element) return false

  const nativeEvent =
    typeof event === 'object' && event !== null && 'nativeEvent' in event
      ? event.nativeEvent
      : event
  if (!hasPointerCoordinates(nativeEvent)) return false

  const rect = element.getBoundingClientRect()
  return (
    nativeEvent.clientX >= rect.left &&
    nativeEvent.clientX <= rect.right &&
    nativeEvent.clientY >= rect.top &&
    nativeEvent.clientY <= rect.bottom
  )
}

const sortProxyOptions = (
  options: ProxyOption[],
  sortType: ProxySortType,
  delayOf: (member: ResolvedProxyMember) => number,
  latencyTimeout?: number,
) => {
  if (sortType === 0) return options
  if (sortType === 2) {
    return [...options].sort((a, b) => a.name.localeCompare(b.name))
  }

  const effectiveTimeout =
    typeof latencyTimeout === 'number' && latencyTimeout > 0
      ? latencyTimeout
      : DEFAULT_DELAY_TIMEOUT

  return options
    .map((option) => ({ option, delay: delayOf(option.member) }))
    .sort((a, b) => {
      const byDelay = compareByDelay(a.delay, b.delay, effectiveTimeout)
      return byDelay || a.option.name.localeCompare(b.option.name)
    })
    .map(({ option }) => option)
}

interface PersistentProxySelectProps {
  label: string
  groupName: string
  fixed?: string
  value: string
  selectedName: string
  selectedDelay: number
  options: ProxyOption[]
  open: boolean
  disabled: boolean
  keepOpenRef: React.RefObject<HTMLElement | null>
  onOpen: () => void
  onClose: () => void
  onChange: (value: string) => void
}

const PersistentProxySelect = ({
  label,
  groupName,
  fixed,
  value,
  selectedName,
  selectedDelay,
  options,
  open,
  disabled,
  keepOpenRef,
  onOpen,
  onClose,
  onChange,
}: PersistentProxySelectProps) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const listboxId = 'current-proxy-node-listbox'
  const labelId = 'proxy-select-label'
  const fixedProxyInUsed = selectedName === fixed

  useEffect(() => {
    if (!open) return

    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        onClose()
      } else if (event.key === 'Escape') {
        onClose()
        anchorRef.current
          ?.querySelector<HTMLElement>('[role="combobox"]')
          ?.focus()
      }
    }
    document.addEventListener('keydown', closeFromKeyboard)
    return () => document.removeEventListener('keydown', closeFromKeyboard)
  }, [onClose, open])

  return (
    <ClickAwayListener
      onClickAway={(event) => {
        if (!open) return
        const target = event.target
        if (target instanceof Node && keepOpenRef.current?.contains(target)) {
          return
        }
        onClose()
      }}
    >
      <Box>
        <FormControl ref={anchorRef} fullWidth variant="outlined" size="small">
          <InputLabel id={labelId}>{label}</InputLabel>
          <Select
            labelId={labelId}
            value={value}
            open={false}
            onOpen={onOpen}
            label={label}
            disabled={disabled}
            renderValue={() => (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography noWrap>{selectedName}</Typography>
                <Chip
                  size="small"
                  label={delayManager.formatDelay(selectedDelay)}
                  color={convertDelayColor(selectedDelay)}
                />
                {fixedProxyInUsed && (
                  <span
                    style={{
                      position: 'absolute',
                      fontSize: '12px',
                      top: '-3px',
                      right: '25px',
                    }}
                  >
                    📌
                  </span>
                )}
              </Box>
            )}
            SelectDisplayProps={{
              'aria-controls': open ? listboxId : undefined,
              'aria-expanded': open ? 'true' : 'false',
            }}
          >
            <MenuItem value={value}>{selectedName}</MenuItem>
          </Select>
        </FormControl>

        <Popper
          open={open}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          sx={{
            width: anchorRef.current?.clientWidth,
            zIndex: (theme) => theme.zIndex.modal,
          }}
        >
          <Paper
            elevation={8}
            sx={{ maxHeight: PROXY_MENU_MAX_HEIGHT, overflow: 'auto' }}
          >
            <MenuList
              id={listboxId}
              role="listbox"
              aria-labelledby={labelId}
              autoFocusItem
              variant="selectedMenu"
            >
              {options.map((option) => {
                const selected = option.value === value
                const isFixed = option.name === fixed
                const delay = option.disabled
                  ? -1
                  : delayManager.getDelayFix(option.member, groupName)

                return (
                  <MenuItem
                    key={option.value}
                    role="option"
                    aria-selected={selected}
                    selected={selected}
                    disabled={option.disabled}
                    onClick={() => {
                      if (!option.disabled) onChange(option.value)
                    }}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      pr: 1,
                    }}
                  >
                    {isFixed && (
                      <span
                        style={{
                          position: 'absolute',
                          fontSize: '12px',
                          top: '-5px',
                          right: '5px',
                          ...(!fixedProxyInUsed && {
                            filter: 'grayscale(1)',
                          }),
                        }}
                      >
                        📌
                      </span>
                    )}
                    <Typography noWrap sx={{ flex: 1, mr: 1 }}>
                      {option.name}
                    </Typography>
                    {!option.disabled && (
                      <Chip
                        size="small"
                        label={delayManager.formatDelay(delay)}
                        color={convertDelayColor(delay)}
                        sx={{
                          minWidth: '60px',
                          height: '22px',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </MenuItem>
                )
              })}
            </MenuList>
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  )
}

export const CurrentProxyCard = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  const { proxyView } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()
  const { isCoreDataPending } = useCoreDataStatus()
  const { verge } = useVerge()
  const { current: currentProfile } = useProfiles()
  const autoDelayEnabled = verge?.enable_auto_delay_detection ?? false
  const defaultLatencyTimeout = verge?.default_latency_timeout
  const autoDelayIntervalMs = useMemo(() => {
    const rawInterval = verge?.auto_delay_detection_interval_minutes
    const intervalMinutes =
      typeof rawInterval === 'number' && rawInterval > 0
        ? rawInterval
        : AUTO_CHECK_DEFAULT_INTERVAL_MINUTES
    return Math.max(1, Math.round(intervalMinutes)) * 60 * 1000
  }, [verge?.auto_delay_detection_interval_minutes])
  const currentProfileId = currentProfile?.uid || null

  const getProfileStorageKey = useCallback(
    (baseKey: string) =>
      currentProfileId ? `${baseKey}:${currentProfileId}` : baseKey,
    [currentProfileId],
  )

  const readProfileScopedItem = useCallback(
    (baseKey: string) => {
      if (typeof window === 'undefined') return null
      const profileKey = getProfileStorageKey(baseKey)
      const profileValue = localStorage.getItem(profileKey)
      if (profileValue != null) {
        return profileValue
      }

      if (profileKey !== baseKey) {
        const legacyValue = localStorage.getItem(baseKey)
        if (legacyValue != null) {
          localStorage.removeItem(baseKey)
          localStorage.setItem(profileKey, legacyValue)
          return legacyValue
        }
      }

      return null
    },
    [getProfileStorageKey],
  )

  const writeProfileScopedItem = useCallback(
    (baseKey: string, value: string) => {
      if (typeof window === 'undefined') return
      const profileKey = getProfileStorageKey(baseKey)
      localStorage.setItem(profileKey, value)
      if (profileKey !== baseKey) {
        localStorage.removeItem(baseKey)
      }
    },
    [getProfileStorageKey],
  )

  const { handleSelectChange } = useProxySelection({
    onSuccess: () => {
      refreshProxy()
    },
    onError: (error) => {
      console.error('代理切换失败', error)
      refreshProxy()
    },
  })

  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  const [sortType, setSortType] = useState<ProxySortType>(() => {
    const savedSortType = localStorage.getItem(STORAGE_KEY_SORT_TYPE)
    return savedSortType ? (Number(savedSortType) as ProxySortType) : 0
  })

  const [selectedGroupName, setSelectedGroupName] = useState('')
  const [openSelect, setOpenSelect] = useState<OpenSelect>(null)
  const delayButtonRef = useRef<HTMLButtonElement>(null)
  const delays = useGroupDelays(selectedGroupName || null)

  const autoCheckInProgressRef = useRef(false)
  const latestTimeoutRef = useRef<number>(
    verge?.default_latency_timeout || 10000,
  )
  const latestProxyMemberRef = useRef<ResolvedProxyMember | null>(null)

  useEffect(() => {
    latestTimeoutRef.current = verge?.default_latency_timeout || 10000
  }, [verge?.default_latency_timeout])

  const selectableGroups = useMemo(() => {
    if (!proxyView) return []
    return proxyView.groups.filter(
      (group) =>
        !group.hidden &&
        (group.type === 'Selector' || group.type === 'URLTest'),
    )
  }, [proxyView])

  const selectedGroup = useMemo<ProxyGroupView | null>(() => {
    if (!proxyView || isDirectMode) return null
    if (isGlobalMode) return proxyView.global
    return (
      selectableGroups.find(({ name }) => name === selectedGroupName) ?? null
    )
  }, [
    isDirectMode,
    isGlobalMode,
    proxyView,
    selectableGroups,
    selectedGroupName,
  ])

  const optionsForGroup = useCallback(
    (group: ProxyGroupView | null): ProxyOption[] =>
      proxyView && group
        ? group.members.map((memberRef, memberIndex) => {
            const member = resolveMember(proxyView, memberRef)
            return {
              memberIndex,
              member,
              value: optionValue(memberIndex, member),
              name: member.ref.name,
              disabled: !isInteractableMember(member),
            }
          })
        : [],
    [proxyView],
  )

  const unsortedProxyOptions = useMemo(
    () => optionsForGroup(selectedGroup),
    [optionsForGroup, selectedGroup],
  )

  useEffect(() => {
    if (!proxyView) return
    if (isDirectMode) {
      setSelectedGroupName('DIRECT')
      return
    }
    if (isGlobalMode) {
      setSelectedGroupName(proxyView.global?.name ?? 'GLOBAL')
      return
    }

    const savedGroup = readProfileScopedItem(STORAGE_KEY_GROUP)
    const primaryKeywords = ['auto', 'select', 'proxy', '节点选择', '自动选择']
    const primaryGroup =
      selectableGroups.find((group) =>
        primaryKeywords.some((keyword) =>
          group.name.toLowerCase().includes(keyword.toLowerCase()),
        ),
      ) ?? selectableGroups[0]
    const nextGroup = selectableGroups.some(
      ({ name }) => name === selectedGroupName,
    )
      ? selectedGroupName
      : selectableGroups.some(({ name }) => name === savedGroup)
        ? savedGroup!
        : (primaryGroup?.name ?? '')
    if (nextGroup !== selectedGroupName) {
      setSelectedGroupName(nextGroup)
      if (nextGroup) writeProfileScopedItem(STORAGE_KEY_GROUP, nextGroup)
    }
  }, [
    isDirectMode,
    isGlobalMode,
    proxyView,
    readProfileScopedItem,
    selectableGroups,
    selectedGroupName,
    writeProfileScopedItem,
  ])

  const currentOption = useMemo(() => {
    if (!proxyView) return undefined
    if (isDirectMode) {
      const node =
        proxyView.direct == null
          ? undefined
          : getRecord(proxyView, proxyView.direct)
      return node
        ? ({
            memberIndex: 0,
            member: {
              kind: 'node',
              ref: { kind: 'node', name: node.name, recordId: node.recordId },
              node,
            },
          } satisfies Pick<ProxyOption, 'memberIndex' | 'member'>)
        : undefined
    }
    return selectedGroup
      ? findCurrentGroupMember(proxyView, selectedGroup)
      : undefined
  }, [isDirectMode, proxyView, selectedGroup])

  latestProxyMemberRef.current = currentOption?.member ?? null

  const handleGroupChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      if (isGlobalMode || isDirectMode) return
      const newGroupName = event.target.value
      setSelectedGroupName(newGroupName)
      writeProfileScopedItem(STORAGE_KEY_GROUP, newGroupName)
    },
    [isDirectMode, isGlobalMode, writeProfileScopedItem],
  )

  const handleProxyChange = useCallback(
    (value: string) => {
      if (isDirectMode) return
      const option = unsortedProxyOptions.find(
        (candidate) => candidate.value === value,
      )
      if (!selectedGroup || !option || !isInteractableMember(option.member)) {
        return
      }
      const previousProxy = selectedGroup.now
      const nextName = option.member.ref.name
      // The profile selection is the durable source across core restarts and run modes.
      handleSelectChange(
        selectedGroup.name,
        previousProxy,
        selectedGroup.fixed,
      )({
        target: { value: nextName },
      })
    },
    [handleSelectChange, isDirectMode, selectedGroup, unsortedProxyOptions],
  )

  const goToProxies = useCallback(() => {
    navigate('/proxies')
  }, [navigate])

  const currentMember = currentOption?.member
  const currentProxy = currentMember ? memberDetails(currentMember) : undefined
  const selectedProxyName = currentMember?.ref.name ?? ''

  const currentDelay =
    currentMember && selectedGroupName
      ? delayManager.getDelayFix(currentMember, selectedGroupName)
      : -1

  const signalInfo =
    currentProxy && selectedGroupName
      ? getSignalIcon(currentDelay, t)
      : {
          icon: <SignalNone />,
          text: t('home.components.currentProxy.status.uninitialized'),
          color: 'text.secondary',
        }

  const checkCurrentProxyDelay = useCallback(async () => {
    if (autoCheckInProgressRef.current) return
    if (isDirectMode) return

    const groupName = selectedGroupName
    const proxyName = selectedProxyName

    if (!groupName || !proxyName) return

    const proxyMember = latestProxyMemberRef.current
    if (!proxyMember || !isInteractableMember(proxyMember)) {
      debugLog(
        `[CurrentProxyCard] 自动延迟检测跳过，组: ${groupName}, 节点: ${proxyName} 未找到`,
      )
      return
    }

    autoCheckInProgressRef.current = true

    const timeout = latestTimeoutRef.current || 10000

    try {
      debugLog(
        `[CurrentProxyCard] 自动检测当前节点延迟，组: ${groupName}, 节点: ${proxyName}`,
      )
      await delayManager.checkDelay(proxyMember, groupName, timeout)
    } catch (error) {
      console.error(
        `[CurrentProxyCard] 自动检测当前节点延迟失败，组: ${groupName}, 节点: ${proxyName}`,
        error,
      )
    } finally {
      autoCheckInProgressRef.current = false
      refreshProxy()
    }
  }, [isDirectMode, refreshProxy, selectedGroupName, selectedProxyName])

  useEffect(() => {
    if (isDirectMode) return
    if (!autoDelayEnabled) return
    if (!selectedGroupName || !selectedProxyName) return

    let disposed = false
    let intervalTimer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null

    const runAndSchedule = async () => {
      if (disposed) return
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }

    initialTimer = setTimeout(async () => {
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }, AUTO_CHECK_INITIAL_DELAY_MS)

    return () => {
      disposed = true
      if (initialTimer) clearTimeout(initialTimer)
      if (intervalTimer) clearTimeout(intervalTimer)
    }
  }, [
    checkCurrentProxyDelay,
    autoDelayIntervalMs,
    isDirectMode,
    selectedGroupName,
    selectedProxyName,
    autoDelayEnabled,
  ])

  const handleSortTypeChange = useCallback(() => {
    const newSortType = ((sortType + 1) % 3) as ProxySortType
    setSortType(newSortType)
    localStorage.setItem(STORAGE_KEY_SORT_TYPE, newSortType.toString())
  }, [sortType])

  const handleCheckDelay = useLockFn(async () => {
    const groupName = selectedGroupName
    if (!groupName || isDirectMode) return

    debugLog(`[CurrentProxyCard] 开始测试所有延迟，组: ${groupName}`)

    const timeout = verge?.default_latency_timeout || 10000

    const interactable = unsortedProxyOptions
      .map(({ member }) => member)
      .filter(isInteractableMember)
      .filter(({ ref }) => ref.name !== 'DIRECT' && ref.name !== 'REJECT')

    if (interactable.length > 0) {
      const url = delayManager.getUrl(groupName)
      debugLog(`[CurrentProxyCard] 测试URL: ${url}, 超时: ${timeout}ms`)

      try {
        await delayManager.checkListDelay(interactable, groupName, timeout)
        debugLog(`[CurrentProxyCard] 延迟测试完成，组: ${groupName}`)
      } catch (error) {
        console.error(
          `[CurrentProxyCard] 延迟测试出错，组: ${groupName}`,
          error,
        )
      }
    }

    refreshProxy()
  })

  const handleGroupMenuClose = useCallback<NonNullable<MenuProps['onClose']>>(
    (event, reason) => {
      if (
        reason === 'backdropClick' &&
        eventHitsElement(event, delayButtonRef.current)
      ) {
        void handleCheckDelay()
        return
      }

      setOpenSelect(null)
    },
    [handleCheckDelay],
  )

  const proxyOptions = useMemo(
    () =>
      isDirectMode
        ? []
        : sortProxyOptions(
            unsortedProxyOptions,
            sortType,
            delays.of,
            defaultLatencyTimeout,
          ),
    [
      delays,
      isDirectMode,
      unsortedProxyOptions,
      sortType,
      defaultLatencyTimeout,
    ],
  )

  const getSortIcon = (): React.ReactElement => {
    switch (sortType) {
      case 1:
        return <AccessTimeRounded fontSize="small" />
      case 2:
        return <SortByAlphaRounded fontSize="small" />
      default:
        return <SortRounded fontSize="small" />
    }
  }

  const getSortTooltip = (): string => {
    switch (sortType) {
      case 0:
        return t('proxies.page.tooltips.sortDefault')
      case 1:
        return t('proxies.page.tooltips.sortDelay')
      case 2:
        return t('proxies.page.tooltips.sortName')
      default:
        return ''
    }
  }

  return (
    <EnhancedCard
      title={t('home.components.currentProxy.title')}
      icon={
        <Tooltip
          title={
            currentProxy
              ? `${signalInfo.text}: ${delayManager.formatDelay(currentDelay)}`
              : t('home.components.currentProxy.status.noProxyNode')
          }
        >
          <Box sx={{ color: signalInfo.color }}>
            {currentProxy ? signalInfo.icon : <SignalNone color="disabled" />}
          </Box>
        </Tooltip>
      }
      iconColor={currentProxy ? 'primary' : undefined}
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip
            title={t('home.components.currentProxy.actions.refreshDelay')}
          >
            <span>
              <IconButton
                ref={delayButtonRef}
                size="small"
                color="inherit"
                onClick={handleCheckDelay}
                disabled={isDirectMode || unsortedProxyOptions.length === 0}
                aria-label={t(
                  'home.components.currentProxy.actions.refreshDelay',
                )}
              >
                <NetworkCheckRounded />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={getSortTooltip()}>
            <IconButton
              size="small"
              color="inherit"
              onClick={handleSortTypeChange}
            >
              {getSortIcon()}
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            size="small"
            onClick={goToProxies}
            sx={{ borderRadius: 1.5 }}
            endIcon={<ChevronRight fontSize="small" />}
          >
            {t('layout.components.navigation.tabs.proxies')}
          </Button>
        </Box>
      }
    >
      {isCoreDataPending ? (
        <Box sx={{ py: 4, height: 24 }} />
      ) : currentProxy || (!isDirectMode && selectedGroup) ? (
        <Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1,
              mb: 2,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.05),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Box>
              <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                {currentProxy?.name ??
                  t('home.components.currentProxy.labels.noActiveNode')}
              </Typography>

              <Box
                sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mr: 1 }}
                >
                  {currentProxy?.type}
                </Typography>
                {isGlobalMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.globalMode')}
                    color="primary"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {isDirectMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.directMode')}
                    color="success"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {currentProxy?.udp && (
                  <Chip size="small" label="UDP" variant="outlined" />
                )}
                {currentProxy?.tfo && (
                  <Chip size="small" label="TFO" variant="outlined" />
                )}
                {currentProxy?.xudp && (
                  <Chip size="small" label="XUDP" variant="outlined" />
                )}
                {currentProxy?.mptcp && (
                  <Chip size="small" label="MPTCP" variant="outlined" />
                )}
                {currentProxy?.smux && (
                  <Chip size="small" label="SMUX" variant="outlined" />
                )}
              </Box>
            </Box>

            {currentProxy && !isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(currentDelay)}
                color={convertDelayColor(currentDelay)}
              />
            )}
          </Box>
          <FormControl
            fullWidth
            variant="outlined"
            size="small"
            sx={{ mb: 1.5 }}
          >
            <InputLabel id="proxy-group-select-label">
              {t('home.components.currentProxy.labels.group')}
            </InputLabel>
            <Select
              labelId="proxy-group-select-label"
              value={selectedGroupName}
              onChange={handleGroupChange}
              open={openSelect === 'group'}
              onOpen={() => setOpenSelect('group')}
              label={t('home.components.currentProxy.labels.group')}
              disabled={isGlobalMode || isDirectMode}
              MenuProps={{ onClose: handleGroupMenuClose }}
            >
              {selectableGroups.map((group) => (
                <MenuItem key={group.name} value={group.name}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <PersistentProxySelect
            label={t('home.components.currentProxy.labels.proxy')}
            groupName={selectedGroupName}
            fixed={selectedGroup?.fixed}
            value={
              currentOption
                ? optionValue(currentOption.memberIndex, currentOption.member)
                : ''
            }
            selectedName={selectedProxyName}
            selectedDelay={currentDelay}
            options={isDirectMode ? [] : proxyOptions}
            open={openSelect === 'proxy'}
            disabled={isDirectMode}
            keepOpenRef={delayButtonRef}
            onOpen={() => setOpenSelect('proxy')}
            onClose={() => setOpenSelect(null)}
            onChange={handleProxyChange}
          />
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography
            sx={{ height: 24 }}
            variant="body1"
            color="text.secondary"
          >
            {t('home.components.currentProxy.labels.noActiveNode')}
          </Typography>
        </Box>
      )}
    </EnhancedCard>
  )
}
