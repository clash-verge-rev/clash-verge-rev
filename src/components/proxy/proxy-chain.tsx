import { arrayMove } from '@dnd-kit/helpers'
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import {
  ArrowDownward,
  Delete as DeleteIcon,
  DragIndicator,
  Link,
  LinkOff,
  WarningRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Typography,
  useTheme,
} from '@mui/material'
import * as yaml from 'js-yaml'
import {
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  closeAllConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { TooltipIcon } from '@/components/base'
import { useRuntimeConfig } from '@/hooks/use-clash'
import { useRecordSelection } from '@/hooks/use-record-selection'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import { updateProxyChainConfigInRuntime } from '@/services/cmds'
import {
  selectGlobalChainNodes,
  selectRuleChainMembers,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

import { rebindProxyChainItems, type ProxyChainItem } from './proxy-chain-model'

type RuntimeConfigWithProxySequence = IConfigData & { proxies?: unknown }

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

interface ProxyChainItemProps {
  id: string
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

interface ChainCardProps {
  proxy: ProxyChainItem
  index: number
  isFirst: boolean
  isLast: boolean
  isDragging?: boolean
  handleRef?: Ref<HTMLElement> | null
  onRemove?: (id: string) => void
}

const ChainCard = ({
  proxy,
  index,
  isFirst,
  isLast,
  isDragging,
  handleRef,
  onRemove,
}: ChainCardProps) => {
  const theme = useTheme()
  const { t } = useTranslation()

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
      sx={{
        mb: 0,
        display: 'flex',
        alignItems: 'center',
        p: 1,
        backgroundColor: theme.palette.background.default,
        borderRadius: 1,
        border: roleColor
          ? `1.5px solid ${roleColor}`
          : `1px solid ${theme.palette.divider}`,
        transition: 'box-shadow 0.2s, background-color 0.2s',
      }}
    >
      <Box
        ref={handleRef}
        sx={{
          display: 'flex',
          alignItems: 'center',
          mr: 1,
          color: theme.palette.text.secondary,
          cursor: isDragging ? 'grabbing' : 'grab',
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

      {onRemove && (
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
      )}
    </Box>
  )
}

const SortableProxyChainItem = ({
  id,
  proxy,
  index,
  isFirst,
  isLast,
  onRemove,
}: ProxyChainItemProps) => {
  const theme = useTheme()
  const [element, setElement] = useState<Element | null>(null)
  const handleRef = useRef<HTMLElement | null>(null)
  const { isDragging } = useSortable({
    id,
    index,
    element,
    handle: handleRef,
  })

  return (
    <Box ref={setElement} className="proxy-chain-item" sx={{ width: '100%' }}>
      <ChainCard
        proxy={proxy}
        index={index}
        isFirst={isFirst}
        isLast={isLast}
        isDragging={isDragging}
        handleRef={handleRef}
        onRemove={onRemove}
      />
      {!isLast && (
        <Box
          className="proxy-chain-arrow"
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
  const { refreshProxy } = useAppRefreshers()
  const { data: runtimeConfig } = useRuntimeConfig(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const recordSelection = useRecordSelection()
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

  const isConnected = useMemo(() => {
    if (!proxyView || currentProxyChain.length === 0) {
      return false
    }

    const lastNode = currentProxyChain[currentProxyChain.length - 1]
    if (localStorage.getItem('proxy-chain-exit-node') === lastNode.name) {
      return true
    }
    if (currentProxyChain.length < 2) return false

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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { operation, canceled } = event
      const { source, target } = operation
      if (canceled || !target || !isSortable(source)) return

      const { index: newIndex, initialIndex: oldIndex } = source.sortable
      if (
        oldIndex < 0 ||
        newIndex < 0 ||
        oldIndex >= currentProxyChain.length ||
        newIndex >= currentProxyChain.length ||
        oldIndex === newIndex
      ) {
        return
      }

      onUpdateChain(arrayMove(currentProxyChain, oldIndex, newIndex))
      markUnsavedChanges()
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
        await refreshProxy()

        onUpdateChain([])
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
      currentProxyChain.some(({ recordId }) => !recordId)
    ) {
      alert(t('proxies.page.chain.minimumNodes'))
      return
    }

    setIsConnecting(true)
    try {
      // 第一步：保存链式代理配置
      const chainProxies = currentProxyChain.map((node) => node.name)
      debugLog('Saving chain config:', chainProxies)
      await updateProxyChainConfigInRuntime(chainProxies)
      debugLog('Chain configuration saved successfully')

      // 第二步：连接到代理链的最后一个节点
      const lastNode = currentProxyChain[currentProxyChain.length - 1]
      debugLog(`Connecting to proxy chain, last node: ${lastNode.name}`)

      // 根据模式确定使用的代理组名称
      if (mode !== 'global' && !selectedGroup) {
        throw new Error('规则模式下必须选择代理组')
      }

      const targetGroup = mode === 'global' ? 'GLOBAL' : selectedGroup

      await selectNodeForGroup(targetGroup || 'GLOBAL', lastNode.name)
      // The chain moves the group like any other selection, so the profile has to learn about
      // it: what the profile holds is what gets re-applied the next time the core starts.
      recordSelection(targetGroup || 'GLOBAL', lastNode.name)
      localStorage.setItem('proxy-chain-group', targetGroup || 'GLOBAL')
      localStorage.setItem('proxy-chain-exit-node', lastNode.name)

      // 刷新代理信息以更新连接状态
      refreshProxy()
      debugLog('Successfully connected to proxy chain')
    } catch (error) {
      console.error('Failed to connect to proxy chain:', error)
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
  ])

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
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="h6">{t('proxies.page.chain.header')}</Typography>
          <TooltipIcon
            title={chainWarning}
            icon={WarningRounded}
            color="warning"
            sx={{ p: 0.25 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {currentProxyChain.length > 0 && (
            <IconButton
              size="small"
              onClick={() => {
                updateProxyChainConfigInRuntime(null)
                localStorage.removeItem('proxy-chain-group')
                localStorage.removeItem('proxy-chain-exit-node')
                localStorage.removeItem('proxy-chain-items')
                onUpdateChain([])
              }}
              sx={{
                color: theme.palette.error.main,
                '&:hover': {
                  backgroundColor: theme.palette.error.light + '20',
                },
              }}
              title={t('proxies.page.actions.clearChainConfig')}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
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
                    ({ recordId }) => recordId === undefined,
                  ) ||
                  (mode === 'global' && proxyView?.global === null) ||
                  (mode !== 'global' && !selectedGroup)))
            }
            color={isConnected ? 'error' : 'success'}
            sx={{
              minWidth: 90,
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
        severity={currentProxyChain.length === 1 ? 'warning' : 'info'}
        sx={{ mb: 2 }}
      >
        {currentProxyChain.length === 1
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
          <DragDropProvider
            sensors={[PointerSensor, KeyboardSensor]}
            onDragEnd={handleDragEnd}
          >
            <Box sx={{ borderRadius: 1, minHeight: 60, p: 1 }}>
              {currentProxyChain.map((proxy, index) => (
                <SortableProxyChainItem
                  key={proxy.id}
                  id={proxy.id}
                  proxy={proxy}
                  index={index}
                  isFirst={index === 0}
                  isLast={
                    index === currentProxyChain.length - 1 &&
                    currentProxyChain.length > 1
                  }
                  onRemove={handleRemoveProxy}
                />
              ))}
            </Box>
          </DragDropProvider>
        )}
      </Box>
    </Paper>
  )
}
