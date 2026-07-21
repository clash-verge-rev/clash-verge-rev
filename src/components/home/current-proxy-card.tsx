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
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
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

// 本地存储的键名
const STORAGE_KEY_GROUP = 'clash-verge-selected-proxy-group'
const STORAGE_KEY_SORT_TYPE = 'clash-verge-proxy-sort-type'

const AUTO_CHECK_DEFAULT_INTERVAL_MINUTES = 5
const AUTO_CHECK_INITIAL_DELAY_MS = 100

// 代理节点信息接口
interface ProxyOption {
  memberIndex: number
  member: ResolvedProxyMember
}

// 排序类型: 默认 | 按延迟 | 按字母
type ProxySortType = 0 | 1 | 2

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

function getSignalIcon(delay: number): {
  icon: React.ReactElement
  text: string
  color: string
} {
  if (delay === -2)
    return { icon: <SignalNone />, text: '测试中', color: 'text.secondary' }
  if (delay === -1)
    return { icon: <SignalNone />, text: '未测试', color: 'text.secondary' }
  if (delay > 1e5)
    return { icon: <SignalError />, text: '错误', color: 'error.main' }
  if (delay === 0 || delay >= 10000)
    return { icon: <SignalError />, text: '超时', color: 'error.main' }
  if (delay >= 500)
    return { icon: <SignalWeak />, text: '延迟较高', color: 'error.main' }
  if (delay >= 300)
    return { icon: <SignalMedium />, text: '延迟中等', color: 'warning.main' }
  if (delay >= 200)
    return { icon: <SignalGood />, text: '延迟良好', color: 'info.main' }
  return { icon: <SignalStrong />, text: '延迟极佳', color: 'success.main' }
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

  // 统一代理选择器
  const { handleSelectChange } = useProxySelection({
    onSuccess: () => {
      refreshProxy()
    },
    onError: (error) => {
      console.error('代理切换失败', error)
      refreshProxy()
    },
  })

  // 判断模式
  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  // Sorting type state
  const [sortType, setSortType] = useState<ProxySortType>(() => {
    const savedSortType = localStorage.getItem(STORAGE_KEY_SORT_TYPE)
    return savedSortType ? (Number(savedSortType) as ProxySortType) : 0
  })
  const [delaySortRefresh, setDelaySortRefresh] = useState(0)

  const [selectedGroupName, setSelectedGroupName] = useState('')

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
        ? group.members.map((member, memberIndex) => ({
            memberIndex,
            member: resolveMember(proxyView, member),
          }))
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
          } satisfies ProxyOption)
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

  const optionValue = (option: ProxyOption) =>
    `${option.memberIndex}:${
      option.member.kind === 'node'
        ? option.member.node.recordId
        : option.member.ref.name
    }`

  const handleProxyChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      if (isDirectMode) return
      const option = unsortedProxyOptions.find(
        (candidate) => optionValue(candidate) === event.target.value,
      )
      if (!selectedGroup || !option || !isInteractableMember(option.member)) {
        return
      }
      const previousProxy = selectedGroup.now
      const nextName = option.member.ref.name
      handleSelectChange(
        selectedGroup.name,
        previousProxy,
        isGlobalMode,
      )({
        target: { value: nextName },
      })
    },
    [
      handleSelectChange,
      isDirectMode,
      isGlobalMode,
      selectedGroup,
      unsortedProxyOptions,
    ],
  )

  // 导航到代理页面
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

  // 信号图标（增加非空校验）
  const signalInfo =
    currentProxy && selectedGroupName
      ? getSignalIcon(currentDelay)
      : { icon: <SignalNone />, text: '未初始化', color: 'text.secondary' }

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
      if (sortType === 1) {
        setDelaySortRefresh((prev) => prev + 1)
      }
    }
  }, [
    isDirectMode,
    refreshProxy,
    selectedGroupName,
    selectedProxyName,
    sortType,
  ])

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

  // 自定义渲染选择框中的值
  const renderProxyValue = () => {
    if (!currentMember) return selectedProxyName
    const delayValue = delayManager.getDelayFix(
      currentMember,
      selectedGroupName,
    )

    return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography noWrap>{selectedProxyName}</Typography>
        <Chip
          size="small"
          label={delayManager.formatDelay(delayValue)}
          color={convertDelayColor(delayValue)}
        />
      </Box>
    )
  }

  // 排序类型变更
  const handleSortTypeChange = useCallback(() => {
    const newSortType = ((sortType + 1) % 3) as ProxySortType
    setSortType(newSortType)
    localStorage.setItem(STORAGE_KEY_SORT_TYPE, newSortType.toString())
  }, [sortType])

  // 延迟测试
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
    if (sortType === 1) {
      setDelaySortRefresh((prev) => prev + 1)
    }
  })

  // 计算要显示的代理选项（增加非空校验）
  const proxyOptions = useMemo(() => {
    const sortWithLatency = (proxiesToSort: ProxyOption[]) => {
      if (!proxiesToSort || sortType === 0) return proxiesToSort

      const list = [...proxiesToSort]

      if (sortType === 1) {
        const refreshTick = delaySortRefresh
        const effectiveTimeout =
          typeof defaultLatencyTimeout === 'number' && defaultLatencyTimeout > 0
            ? defaultLatencyTimeout
            : 10000

        const categorizeDelay = (delay: number): [number, number] => {
          if (!Number.isFinite(delay)) return [5, Number.MAX_SAFE_INTEGER]
          if (delay > 1e5) return [4, delay]
          if (delay === 0 || (delay >= effectiveTimeout && delay <= 1e5)) {
            return [3, delay || effectiveTimeout]
          }
          if (delay < 0) return [5, Number.MAX_SAFE_INTEGER]
          return [0, delay]
        }

        list.sort((a, b) => {
          const [ar, av] = categorizeDelay(
            delayManager.getDelayFix(a.member, selectedGroupName),
          )
          const [br, bv] = categorizeDelay(
            delayManager.getDelayFix(b.member, selectedGroupName),
          )

          if (ar !== br) return ar - br
          if (av !== bv) return av - bv
          return refreshTick >= 0
            ? a.member.ref.name.localeCompare(b.member.ref.name)
            : 0
        })
      } else {
        list.sort((a, b) => a.member.ref.name.localeCompare(b.member.ref.name))
      }

      return list
    }

    if (isDirectMode) {
      return []
    }
    return sortWithLatency(unsortedProxyOptions)
  }, [
    isDirectMode,
    unsortedProxyOptions,
    selectedGroupName,
    sortType,
    delaySortRefresh,
    defaultLatencyTimeout,
  ])

  // 获取排序图标
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

  // 获取排序提示文本
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
              : '无代理节点'
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
                size="small"
                color="inherit"
                onClick={handleCheckDelay}
                disabled={isDirectMode || unsortedProxyOptions.length === 0}
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
          {/* 代理节点信息显示 */}
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
                {/* 节点特性 */}
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

            {/* 显示延迟 */}
            {currentProxy && !isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(currentDelay)}
                color={convertDelayColor(currentDelay)}
              />
            )}
          </Box>
          {/* 代理组选择器 */}
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
              label={t('home.components.currentProxy.labels.group')}
              disabled={isGlobalMode || isDirectMode}
            >
              {selectableGroups.map((group) => (
                <MenuItem key={group.name} value={group.name}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 代理节点选择器 */}
          <FormControl fullWidth variant="outlined" size="small" sx={{ mb: 0 }}>
            <InputLabel id="proxy-select-label">
              {t('home.components.currentProxy.labels.proxy')}
            </InputLabel>
            <Select
              labelId="proxy-select-label"
              value={currentOption ? optionValue(currentOption) : ''}
              onChange={handleProxyChange}
              label={t('home.components.currentProxy.labels.proxy')}
              disabled={isDirectMode}
              renderValue={renderProxyValue}
              MenuProps={{
                slotProps: {
                  paper: {
                    style: {
                      maxHeight: 500,
                    },
                  },
                },
              }}
            >
              {isDirectMode
                ? null
                : proxyOptions.map((option) => {
                    const interactable = isInteractableMember(option.member)
                    const delayValue = interactable
                      ? delayManager.getDelayFix(
                          option.member,
                          selectedGroupName,
                        )
                      : -1
                    return (
                      <MenuItem
                        key={optionValue(option)}
                        value={optionValue(option)}
                        disabled={!interactable}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                          pr: 1,
                        }}
                      >
                        <Typography noWrap sx={{ flex: 1, mr: 1 }}>
                          {option.member.ref.name}
                        </Typography>
                        {interactable && (
                          <Chip
                            size="small"
                            label={delayManager.formatDelay(delayValue)}
                            color={convertDelayColor(delayValue)}
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
            </Select>
          </FormControl>
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
