import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDownward,
  Delete as DeleteIcon,
  DragIndicator,
  Link,
  LinkOff,
  Speed,
  WarningRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import * as yaml from 'js-yaml'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closeAllConnections,
  delayProxyByName,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { TooltipIcon } from '@/components/base'
import { useRuntimeConfig } from '@/hooks/use-clash'
import { useRecordSelection } from '@/hooks/use-record-selection'
import { useVerge } from '@/hooks/use-verge'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import { updateProxyChainConfigInRuntime } from '@/services/cmds'
import {
  selectGlobalChainNodes,
  selectRuleChainMembers,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

import {
  rebindProxyChainItems,
  toProxyChainPayload,
  type ProxyChainItem,
} from './proxy-chain-model'

type RuntimeConfigWithProxySequence = IConfigData & { proxies?: unknown }

const DEFAULT_CHAIN_TEST_URLS = [
  'https://www.google.com/generate_204',
  'https://connectivitycheck.gstatic.com/generate_204',
  'https://www.youtube.com/generate_204',
]

const testTargetLabel = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

interface ParsedChainConfig {
  proxies?: Array<{
    name: string
    type: string
    [key: string]: any
  }>
}

interface ProxyChainProps {
  proxyChain: ProxyChainItem[]
  onUpdateChain: (chain: ProxyChainItem[]) => void
  chainConfigData?: string | null
  onMarkUnsavedChanges?: () => void
  mode?: string
  selectedGroup?: string | null
}

interface SortableItemProps {
  proxy: ProxyChainItem
  index: number
  isFirst: boolean
  isLast: boolean
  onRemove: (id: string) => void
}

const toChainItems = (
  parsedConfig: ParsedChainConfig | null | undefined,
): ProxyChainItem[] => {
  const timestamp = Date.now()

  return (
    parsedConfig?.proxies?.map((proxy, index) => ({
      id: `${proxy.name}_${timestamp}_${index}`,
      name: proxy.name,
      type: proxy.type,
      delay: undefined,
    })) || []
  )
}

const getProxyName = (proxy: unknown) =>
  typeof proxy === 'object' && proxy !== null && 'name' in proxy
    ? (proxy as Record<string, unknown>).name
    : undefined

const getDialerProxy = (proxy: unknown) =>
  typeof proxy === 'object' && proxy !== null && 'dialer-proxy' in proxy
    ? (proxy as Record<string, unknown>)['dialer-proxy']
    : undefined

const extractRuntimeChainNames = (
  runtimeConfig: RuntimeConfigWithProxySequence | null | undefined,
  exitNodeName: string | undefined,
) => {
  if (!exitNodeName || !Array.isArray(runtimeConfig?.proxies)) return []

  const proxies = runtimeConfig.proxies
  const chain: string[] = []
  let currentName: unknown = exitNodeName
  const seen = new Set<string>()

  while (typeof currentName === 'string' && !seen.has(currentName)) {
    const currentProxy = proxies.find(
      (proxy) => getProxyName(proxy) === currentName,
    )
    if (!currentProxy) break
    chain.push(currentName)
    seen.add(currentName)
    const dialerProxy = getDialerProxy(currentProxy)
    if (typeof dialerProxy !== 'string') break
    currentName = dialerProxy
  }

  return chain.reverse()
}

const sameChain = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((name, index) => name === right[index])

const isResolvableChainItem = (item: ProxyChainItem) =>
  item.recordId !== undefined || item.profileUid !== undefined

const SortableItem = ({
  proxy,
  index,
  isFirst,
  isLast,
  onRemove,
}: SortableItemProps) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: proxy.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const roleLabel = isFirst
    ? t('proxies.page.chain.entryNode')
    : isLast
      ? t('proxies.page.chain.exitNode')
      : undefined

  const roleColor = isFirst
    ? theme.palette.success.main
    : isLast
      ? theme.palette.warning.main
      : undefined

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 0,
        display: 'flex',
        alignItems: 'center',
        p: 1,
        backgroundColor: isDragging
          ? theme.palette.action.selected
          : theme.palette.background.default,
        borderRadius: 1,
        border: roleColor
          ? `1.5px solid ${roleColor}`
          : `1px solid ${theme.palette.divider}`,
        boxShadow: isDragging ? theme.shadows[4] : theme.shadows[1],
        transition: 'box-shadow 0.2s, background-color 0.2s',
        opacity: proxy.recordId === undefined ? 0.55 : undefined,
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          mr: 1,
          color: theme.palette.text.secondary,
          cursor: 'grab',
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      >
        <DragIndicator />
      </Box>

      {roleLabel ? (
        <Chip
          label={roleLabel}
          size="small"
          sx={{
            mr: 1,
            fontWeight: 700,
            color: '#fff',
            backgroundColor: roleColor,
          }}
        />
      ) : (
        <Chip
          label={`${index + 1}`}
          size="small"
          color="primary"
          sx={{ mr: 1, minWidth: 32 }}
        />
      )}

      <Typography
        variant="body2"
        sx={{
          flex: 1,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {proxy.name}
      </Typography>

      {proxy.type && (
        <Chip
          label={proxy.type}
          size="small"
          variant="outlined"
          sx={{ mr: 1 }}
        />
      )}

      {proxy.delay !== undefined && (
        <Chip
          label={
            proxy.delay > 0 ? `${proxy.delay}ms` : t('shared.labels.timeout')
          }
          size="small"
          color={
            proxy.delay > 0 && proxy.delay < 200
              ? 'success'
              : proxy.delay > 0 && proxy.delay < 800
                ? 'warning'
                : 'error'
          }
          sx={{ mr: 1, fontSize: '0.7rem', minWidth: 50 }}
        />
      )}

      <IconButton
        size="small"
        onClick={() => onRemove(proxy.id)}
        sx={{
          color: theme.palette.error.main,
          '&:hover': {
            backgroundColor: theme.palette.error.light + '20',
          },
        }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

export const ProxyChain = ({
  proxyChain,
  onUpdateChain,
  chainConfigData,
  onMarkUnsavedChanges,
  mode,
  selectedGroup,
}: ProxyChainProps) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const chainWarning = t('proxies.page.chain.warning')
  const { proxyView } = useProxiesData()
  const { verge } = useVerge()
  const { refreshProxy } = useAppRefreshers()
  const { data: runtimeConfig, refetch: refreshRuntimeConfig } =
    useRuntimeConfig(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const recordSelection = useRecordSelection()
  const [chainApplyError, setChainApplyError] = useState<string | null>(null)
  const [chainTestDelay, setChainTestDelay] = useState<number | null>(null)
  const [chainTestUrl, setChainTestUrl] = useState<string | null>(null)
  const [isTestingChain, setIsTestingChain] = useState(false)
  const markUnsavedChanges = useCallback(() => {
    onMarkUnsavedChanges?.()
  }, [onMarkUnsavedChanges])

  const candidates = useMemo(() => {
    if (!proxyView) return []
    if (mode === 'rule' && selectedGroup) {
      return selectRuleChainMembers(proxyView, selectedGroup).flatMap(
        ({ member }) => (member.kind === 'node' ? [member.node] : []),
      )
    }
    if (!runtimeConfig) return []
    const runtimeProxies = (
      runtimeConfig as RuntimeConfigWithProxySequence | null
    )?.proxies
    return selectGlobalChainNodes(proxyView, runtimeProxies)
  }, [mode, proxyView, runtimeConfig, selectedGroup])

  const currentProxyChain = useMemo(
    () =>
      proxyView
        ? rebindProxyChainItems(proxyChain, candidates, proxyView)
        : proxyChain.map((item) => ({
            ...item,
            recordId: undefined,
            delay: undefined,
          })),
    [candidates, proxyChain, proxyView],
  )

  const expectedChainNames = useMemo(
    () => currentProxyChain.map(({ name }) => name),
    [currentProxyChain],
  )

  const runtimeChainNames = useMemo(() => {
    const lastNode = currentProxyChain.at(-1)
    return extractRuntimeChainNames(
      runtimeConfig as RuntimeConfigWithProxySequence | null | undefined,
      lastNode?.name,
    )
  }, [currentProxyChain, runtimeConfig])

  const isRuntimeChainApplied = useMemo(
    () =>
      expectedChainNames.length >= 2 &&
      sameChain(expectedChainNames, runtimeChainNames),
    [expectedChainNames, runtimeChainNames],
  )

  const isSelectedExitNode = useMemo(() => {
    if (!proxyView || currentProxyChain.length === 0) {
      return false
    }

    const lastNode = currentProxyChain[currentProxyChain.length - 1]
    if (mode === 'global') {
      return proxyView.global?.now === lastNode.name
    }

    if (!selectedGroup) {
      return false
    }

    const proxyChainGroup = proxyView.groups.find(
      (group) => group.name === selectedGroup,
    )

    return proxyChainGroup?.now === lastNode.name
  }, [proxyView, currentProxyChain, mode, selectedGroup])

  const isConnected = isSelectedExitNode && isRuntimeChainApplied

  const runtimeStatus = chainApplyError
    ? t('proxies.page.chain.runtimeFailed')
    : isRuntimeChainApplied
      ? t('proxies.page.chain.runtimeApplied')
      : currentProxyChain.length >= 2
        ? t('proxies.page.chain.runtimePending')
        : t('proxies.page.chain.runtimeNotConfigured')

  // 监听链的变化，但排除从配置加载的情况
  const chainLengthRef = useRef(currentProxyChain.length)
  useEffect(() => {
    // 只有当链长度发生变化且不是初始加载时，才标记为未保存
    if (
      chainLengthRef.current !== currentProxyChain.length &&
      chainLengthRef.current !== 0
    ) {
      markUnsavedChanges()
    }
    chainLengthRef.current = currentProxyChain.length
  }, [currentProxyChain.length, markUnsavedChanges])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (active.id !== over?.id) {
        const oldIndex = currentProxyChain.findIndex(
          (item) => item.id === active.id,
        )
        const newIndex = currentProxyChain.findIndex(
          (item) => item.id === over?.id,
        )

        onUpdateChain(arrayMove(currentProxyChain, oldIndex, newIndex))
        markUnsavedChanges()
      }
    },
    [currentProxyChain, onUpdateChain, markUnsavedChanges],
  )

  const handleRemoveProxy = useCallback(
    (id: string) => {
      const newChain = currentProxyChain.filter((item) => item.id !== id)
      onUpdateChain(newChain)
      markUnsavedChanges()
    },
    [currentProxyChain, onUpdateChain, markUnsavedChanges],
  )

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      setIsConnecting(true)
      try {
        await updateProxyChainConfigInRuntime(null)

        const targetGroup =
          mode === 'global'
            ? 'GLOBAL'
            : selectedGroup || localStorage.getItem('proxy-chain-group')

        if (targetGroup) {
          try {
            await selectNodeForGroup(targetGroup, 'DIRECT')
            recordSelection(targetGroup, 'DIRECT')
          } catch {
            if (currentProxyChain.length >= 1) {
              try {
                await selectNodeForGroup(targetGroup, currentProxyChain[0].name)
                recordSelection(targetGroup, currentProxyChain[0].name)
              } catch {
                // ignore
              }
            }
          }
        }

        localStorage.removeItem('proxy-chain-group')
        localStorage.removeItem('proxy-chain-exit-node')
        localStorage.removeItem('proxy-chain-items')

        await closeAllConnections()
        await refreshRuntimeConfig()
        await refreshProxy()

        onUpdateChain([])
        setChainApplyError(null)
        setChainTestDelay(null)
        setChainTestUrl(null)
      } catch (error) {
        console.error('Failed to disconnect from proxy chain:', error)
        alert(t('proxies.page.chain.disconnectFailed'))
      } finally {
        setIsConnecting(false)
      }
      return
    }

    if (mode === 'global' && proxyView?.global === null) {
      alert(t('proxies.page.chain.connectFailed'))
      return
    }

    if (
      currentProxyChain.length < 2 ||
      currentProxyChain.some((item) => !isResolvableChainItem(item))
    ) {
      alert(t('proxies.page.chain.minimumNodes'))
      return
    }

    setIsConnecting(true)
    try {
      // 第一步：保存链式代理配置
      setChainApplyError(null)
      setChainTestDelay(null)
      setChainTestUrl(null)
      if (mode !== 'global' && !selectedGroup) {
        throw new Error('规则模式下必须选择代理组')
      }

      const targetGroup = mode === 'global' ? 'GLOBAL' : selectedGroup
      const chainProxies = toProxyChainPayload(currentProxyChain)
      debugLog('Saving chain config:', chainProxies)
      await updateProxyChainConfigInRuntime(
        chainProxies,
        targetGroup || 'GLOBAL',
      )
      debugLog('Chain configuration saved successfully')

      // 第二步：连接到代理链的最后一个节点
      const lastNode = currentProxyChain[currentProxyChain.length - 1]
      debugLog(`Connecting to proxy chain, last node: ${lastNode.name}`)

      await selectNodeForGroup(targetGroup || 'GLOBAL', lastNode.name)
      // The chain moves the group like any other selection, so the profile has to learn about
      // it: what the profile holds is what gets re-applied the next time the core starts.
      recordSelection(targetGroup || 'GLOBAL', lastNode.name)
      localStorage.setItem('proxy-chain-group', targetGroup || 'GLOBAL')
      localStorage.setItem('proxy-chain-exit-node', lastNode.name)

      // 刷新代理信息以更新连接状态
      await refreshRuntimeConfig()
      await refreshProxy()
      debugLog('Successfully connected to proxy chain')
    } catch (error) {
      console.error('Failed to connect to proxy chain:', error)
      setChainApplyError(error instanceof Error ? error.message : String(error))
      alert(t('proxies.page.chain.connectFailed'))
    } finally {
      setIsConnecting(false)
    }
  }, [
    currentProxyChain,
    isConnected,
    t,
    refreshProxy,
    mode,
    proxyView,
    selectedGroup,
    onUpdateChain,
    recordSelection,
    refreshRuntimeConfig,
  ])

  const handleTestChain = useCallback(async () => {
    setIsTestingChain(true)
    setChainTestDelay(null)
    setChainTestUrl(null)
    try {
      const configuredUrl = verge?.default_latency_test?.trim()
      const targets = [configuredUrl, ...DEFAULT_CHAIN_TEST_URLS].filter(
        (url, index, urls): url is string =>
          !!url && urls.indexOf(url) === index,
      )
      let lastError: unknown
      const exitNode = currentProxyChain.at(-1)
      if (!exitNode) throw new Error('Proxy chain has no exit node')
      const timeout = verge?.default_latency_timeout || 10000
      for (const target of targets) {
        try {
          const result = await delayProxyByName(exitNode.name, target, timeout)
          if (result.delay <= 0) {
            throw new Error(`Chain test timed out: ` + target)
          }
          setChainTestDelay(result.delay)
          setChainTestUrl(target)
          return
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error('No chain test target is available')
    } catch (error) {
      console.error('Failed to test proxy chain:', error)
      setChainTestDelay(0)
    } finally {
      setIsTestingChain(false)
    }
  }, [
    currentProxyChain,
    verge?.default_latency_test,
    verge?.default_latency_timeout,
  ])

  const handleClearChain = useCallback(async () => {
    try {
      await updateProxyChainConfigInRuntime(null)
      localStorage.removeItem('proxy-chain-group')
      localStorage.removeItem('proxy-chain-exit-node')
      localStorage.removeItem('proxy-chain-items')
      setChainApplyError(null)
      setChainTestDelay(null)
      setChainTestUrl(null)
      onUpdateChain([])
      await refreshRuntimeConfig()
      await refreshProxy()
    } catch (error) {
      console.error('Failed to clear proxy chain:', error)
      setChainApplyError(error instanceof Error ? error.message : String(error))
      alert(t('proxies.page.chain.disconnectFailed'))
    }
  }, [onUpdateChain, refreshProxy, refreshRuntimeConfig, t])

  // 处理链式代理配置数据
  useEffect(() => {
    if (chainConfigData) {
      try {
        // JSON is valid YAML, so one parser covers both persisted formats.
        const parsedConfig = yaml.load(chainConfigData) as ParsedChainConfig
        const chainItems = toChainItems(parsedConfig)

        if (chainItems.length > 0) {
          onUpdateChain(chainItems)
        }
      } catch (error) {
        console.error('Failed to process chain config data:', error)
      }
    }
  }, [chainConfigData, onUpdateChain])

  return (
    <Paper
      elevation={1}
      sx={{
        height: '100%',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 1.25,
          mb: 2,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.35 }}>
              {t('proxies.page.chain.header')}
            </Typography>
            <TooltipIcon
              title={chainWarning}
              icon={WarningRounded}
              color="warning"
              sx={{ p: 0.25 }}
            />
          </Box>
          <Chip
            size="small"
            label={runtimeStatus}
            color={
              chainApplyError
                ? 'error'
                : isRuntimeChainApplied
                  ? 'success'
                  : 'default'
            }
            variant={
              isRuntimeChainApplied || chainApplyError ? 'filled' : 'outlined'
            }
            sx={{ flexShrink: 0 }}
          />
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {isConnected && (
              <Tooltip
                title={
                  chainTestUrl
                    ? t('proxies.page.chain.testChainTarget', {
                        host: testTargetLabel(chainTestUrl),
                      })
                    : t('proxies.page.chain.testChainHint')
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Speed />}
                    onClick={handleTestChain}
                    disabled={isTestingChain}
                  >
                    {isTestingChain
                      ? t('proxies.page.chain.testingChain')
                      : chainTestDelay === null
                        ? t('proxies.page.chain.testChain')
                        : chainTestDelay > 0 && chainTestDelay < 10000
                          ? t('proxies.page.chain.chainDelay', {
                              delay: chainTestDelay,
                            })
                          : t('proxies.page.chain.chainTimeout')}
                  </Button>
                </span>
              </Tooltip>
            )}
            {currentProxyChain.length > 0 && (
              <IconButton
                size="small"
                onClick={handleClearChain}
                sx={{
                  color: theme.palette.error.main,
                  '&:hover': {
                    backgroundColor: theme.palette.error.light + '20',
                  },
                }}
                title={t('proxies.page.actions.clearChainConfig')}
                disabled={isConnecting}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
          <Button
            size="small"
            variant="contained"
            startIcon={isConnected ? <LinkOff /> : <Link />}
            onClick={handleConnect}
            disabled={
              isConnecting ||
              (!isConnected &&
                (currentProxyChain.length < 2 ||
                  currentProxyChain.some(
                    (item) => !isResolvableChainItem(item),
                  ) ||
                  (mode === 'global' && proxyView?.global === null) ||
                  (mode !== 'global' && !selectedGroup)))
            }
            color={isConnected ? 'error' : 'success'}
            sx={{
              minWidth: 90,
              flexShrink: 0,
            }}
            title={
              !isConnected && currentProxyChain.length < 2
                ? t('proxies.page.chain.minimumNodes')
                : undefined
            }
          >
            {isConnecting
              ? t('proxies.page.actions.connecting')
              : isConnected
                ? t('proxies.page.actions.disconnect')
                : t('proxies.page.actions.connect')}
          </Button>
        </Box>
      </Box>

      <Alert
        severity={
          chainApplyError
            ? 'error'
            : currentProxyChain.length === 1
              ? 'warning'
              : 'info'
        }
        sx={{ mb: 2 }}
      >
        {chainApplyError
          ? chainApplyError
          : currentProxyChain.length === 1
            ? t('proxies.page.chain.minimumNodesHint')
            : t('proxies.page.chain.instruction')}
      </Alert>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {currentProxyChain.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.palette.text.secondary,
            }}
          >
            <Typography>{t('proxies.page.chain.empty')}</Typography>
          </Box>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={currentProxyChain.map((proxy) => proxy.id)}
              strategy={verticalListSortingStrategy}
            >
              <Box
                sx={{
                  borderRadius: 1,
                  minHeight: 60,
                  p: 1,
                }}
              >
                {currentProxyChain.map((proxy, index) => (
                  <Box key={proxy.id}>
                    <SortableItem
                      proxy={proxy}
                      index={index}
                      isFirst={index === 0}
                      isLast={
                        index === currentProxyChain.length - 1 &&
                        currentProxyChain.length > 1
                      }
                      onRemove={handleRemoveProxy}
                    />
                    {index < currentProxyChain.length - 1 && (
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'center',
                          py: 0.25,
                        }}
                      >
                        <ArrowDownward
                          sx={{
                            fontSize: 20,
                            color: theme.palette.primary.main,
                            opacity: 0.7,
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            </SortableContext>
          </DndContext>
        )}
      </Box>
    </Paper>
  )
}
