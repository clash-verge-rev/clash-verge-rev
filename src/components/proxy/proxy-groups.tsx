import { ExpandMoreRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useLockFn } from 'ahooks'
import {
  type Key,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { delayGroup, healthcheckProxyProvider } from 'tauri-plugin-mihomo-api'

import { BaseEmpty } from '@/components/base'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useVerge } from '@/hooks/use-verge'
import { useProxiesData } from '@/providers/app-data-context'
import { calcuProxies, updateProxyChainConfigInRuntime } from '@/services/cmds'
import delayManager from '@/services/delay'
import { useQuery } from '@/services/query-client'
import { debugLog } from '@/utils/debug'

import { ScrollTopButton } from '../layout/scroll-top-button'

import { ProxyChain } from './proxy-chain'
import {
  DEFAULT_HOVER_DELAY,
  ProxyGroupNavigator,
} from './proxy-group-navigator'
import { ProxyRender } from './proxy-render'
import type { HeadState } from './use-head-state'
import { type IRenderItem, useRenderList } from './use-render-list'

function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: Parameters<T>) => ref.current(...args), []) as T
}

interface Props {
  mode: string
  isChainMode?: boolean
  chainConfigData?: string | null
}

interface ProxyChainItem {
  id: string
  name: string
  type?: string
  delay?: number
}

export const ProxyGroups = (props: Props) => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { mode, isChainMode = false, chainConfigData } = props

  // Drive 3s polling on the shared TQ cache; data is read via granular context below
  useQuery({
    queryKey: ['getProxies'],
    queryFn: calcuProxies,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    staleTime: 1500,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const [proxyChain, setProxyChain] = useState<ProxyChainItem[]>(() => {
    try {
      const saved = localStorage.getItem('proxy-chain-items')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch {
      // ignore
    }
    return []
  })
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  useEffect(() => {
    if (proxyChain.length > 0) {
      localStorage.setItem('proxy-chain-items', JSON.stringify(proxyChain))
    } else {
      localStorage.removeItem('proxy-chain-items')
    }
  }, [proxyChain])
  const [ruleMenuAnchor, setRuleMenuAnchor] = useState<null | HTMLElement>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<{
    open: boolean
    message: string
  }>({ open: false, message: '' })

  const { verge } = useVerge()
  const { proxies: proxiesData } = useProxiesData()
  const groups = proxiesData?.groups
  const availableGroups = useMemo(() => {
    if (!groups) return []
    // 在链式代理模式下，仅显示支持选择节点的代理组
    return isChainMode
      ? groups.filter((g: any) => g.type === 'Selector' || g.type === 'URLTest')
      : groups
  }, [groups, isChainMode])

  const defaultRuleGroup = useMemo(() => {
    if (isChainMode && mode === 'rule' && availableGroups.length > 0) {
      return availableGroups[0].name
    }
    return null
  }, [availableGroups, isChainMode, mode])

  const activeSelectedGroup = useMemo(
    () => selectedGroup ?? defaultRuleGroup,
    [selectedGroup, defaultRuleGroup],
  )

  const { renderList, onProxies, onHeadState } = useRenderList(
    mode,
    isChainMode,
    activeSelectedGroup,
  )

  const getGroupHeadState = useCallback(
    (groupName: string) => {
      const headItem = renderList.find(
        (item) => item.type === 1 && item.group?.name === groupName,
      )
      return headItem?.headState
    },
    [renderList],
  )

  // 统代理选择
  const { handleProxyGroupChange } = useProxySelection({
    onSuccess: () => {
      onProxies()
    },
    onError: (error) => {
      console.error('代理切换失败', error)
      onProxies()
    },
  })

  const timeout = verge?.default_latency_timeout || 10000

  const parentRef = useRef<HTMLDivElement>(null)
  const scrollPositionRef = useRef<Record<string, number>>({})
  const scrollTopRef = useRef(0)
  const showScrollTopRef = useRef(false)
  const activeStickyIndexRef = useRef<number | null>(null)
  const restoredScrollKeyRef = useRef<string | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const scrollPositionKey = useMemo(
    () =>
      isChainMode
        ? `${mode}:chain:${activeSelectedGroup ?? 'all'}`
        : `${mode}:normal`,
    [activeSelectedGroup, isChainMode, mode],
  )
  const stickyGroupIndexes = useMemo(
    () =>
      renderList.flatMap((item, index) =>
        item.type === 0 && !item.group.hidden ? [index] : [],
      ),
    [renderList],
  )

  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      let activeStickyIndex: number | undefined
      for (let i = stickyGroupIndexes.length - 1; i >= 0; i -= 1) {
        const index = stickyGroupIndexes[i]
        if (index <= range.startIndex) {
          activeStickyIndex = index
          break
        }
      }
      activeStickyIndexRef.current = activeStickyIndex ?? null

      const indexes = defaultRangeExtractor(range)
      return activeStickyIndex == null || indexes.includes(activeStickyIndex)
        ? indexes
        : [activeStickyIndex, ...indexes]
    },
    [stickyGroupIndexes],
  )

  const virtualizer = useVirtualizer({
    count: renderList.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
    getItemKey: (index) => renderList[index]?.key ?? index,
    rangeExtractor,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const activeStickyIndex = activeStickyIndexRef.current

  // 从 localStorage 恢复滚动位置
  useLayoutEffect(() => {
    if (renderList.length === 0) return
    const node = parentRef.current
    if (!node) return
    if (
      restoredScrollKeyRef.current === scrollPositionKey &&
      node.scrollTop === scrollTopRef.current
    ) {
      return
    }

    try {
      const savedPositions = localStorage.getItem('proxy-scroll-positions')
      if (savedPositions) {
        const positions = JSON.parse(savedPositions)
        scrollPositionRef.current = positions
        const savedPosition = positions[scrollPositionKey]

        if (savedPosition !== undefined) {
          node.scrollTop = savedPosition
          scrollTopRef.current = savedPosition
          const nextShowScrollTop = savedPosition > 100
          showScrollTopRef.current = nextShowScrollTop
          queueMicrotask(() => setShowScrollTop(nextShowScrollTop))
        }
      }
    } catch (e) {
      console.error('Error restoring scroll position:', e)
    }
    restoredScrollKeyRef.current = scrollPositionKey
  }, [pathname, renderList.length, scrollPositionKey])

  // 改为使用节流函数保存滚动位置
  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      try {
        scrollPositionRef.current[scrollPositionKey] = scrollTop
        localStorage.setItem(
          'proxy-scroll-positions',
          JSON.stringify(scrollPositionRef.current),
        )
      } catch (e) {
        console.error('Error saving scroll position:', e)
      }
    },
    [scrollPositionKey],
  )

  const saveScrollPositionThrottled = useMemo(
    () => throttle(saveScrollPosition, 500),
    [saveScrollPosition],
  )

  const handleScroll = useCallback(
    (event: Event) => {
      const target = event.target as HTMLElement | null
      const nextScrollTop = target?.scrollTop ?? 0
      const nextShowScrollTop = nextScrollTop > 100
      scrollTopRef.current = nextScrollTop

      if (showScrollTopRef.current !== nextShowScrollTop) {
        showScrollTopRef.current = nextShowScrollTop
        setShowScrollTop(nextShowScrollTop)
      }

      saveScrollPositionThrottled(nextScrollTop)
    },
    [saveScrollPositionThrottled],
  )

  // 添加和清理滚动事件监听器
  useEffect(() => {
    const node = parentRef.current
    if (!node) return

    const listener = handleScroll as EventListener
    const options: AddEventListenerOptions = { passive: true }

    node.addEventListener('scroll', listener, options)

    return () => {
      if (restoredScrollKeyRef.current === scrollPositionKey) {
        saveScrollPosition(scrollTopRef.current)
      }
      node.removeEventListener('scroll', listener, options)
    }
  }, [handleScroll, saveScrollPosition, scrollPositionKey])

  // 滚动到顶部
  const scrollToTop = useCallback(() => {
    parentRef.current?.scrollTo?.({
      top: 0,
      behavior: 'smooth',
    })
    scrollTopRef.current = 0
    saveScrollPosition(0)
  }, [saveScrollPosition])

  // 关闭重复节点警告
  const handleCloseDuplicateWarning = useCallback(() => {
    setDuplicateWarning({ open: false, message: '' })
  }, [])

  const currentGroup = useMemo(() => {
    if (!activeSelectedGroup) return null
    return (
      availableGroups.find(
        (group: any) => group.name === activeSelectedGroup,
      ) ?? null
    )
  }, [activeSelectedGroup, availableGroups])

  // 处理代理组选择菜单
  const handleGroupMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setRuleMenuAnchor(event.currentTarget)
  }

  const handleGroupMenuClose = () => {
    setRuleMenuAnchor(null)
  }

  const handleGroupSelect = (groupName: string) => {
    setSelectedGroup(groupName)
    handleGroupMenuClose()

    if (isChainMode && mode === 'rule') {
      updateProxyChainConfigInRuntime(null)
      localStorage.removeItem('proxy-chain-group')
      localStorage.removeItem('proxy-chain-exit-node')
      localStorage.removeItem('proxy-chain-items')
      setProxyChain([])
    }
  }

  const handleChangeProxy = useCallback(
    (group: IProxyGroupItem, proxy: IProxyItem) => {
      if (isChainMode) {
        // 使用函数式更新来避免状态延迟问题
        setProxyChain((prev) => {
          // 检查是否已经存在相同名称的代理，防止重复添加
          if (prev.some((item) => item.name === proxy.name)) {
            const warningMessage = t('proxies.page.chain.duplicateNode')
            setDuplicateWarning({
              open: true,
              message: warningMessage,
            })
            return prev // 返回原来的状态，不做任何更改
          }

          // 安全获取延迟数据，如果没有延迟数据则设为 undefined
          const delay =
            proxy.history && proxy.history.length > 0
              ? proxy.history[proxy.history.length - 1].delay
              : undefined

          const chainItem: ProxyChainItem = {
            id: `${proxy.name}_${Date.now()}`,
            name: proxy.name,
            type: proxy.type,
            delay: delay,
          }

          return [...prev, chainItem]
        })
        return
      }

      if (!['Selector', 'URLTest', 'Fallback'].includes(group.type)) return

      handleProxyGroupChange(group, proxy)
    },
    [handleProxyGroupChange, isChainMode, t],
  )

  // 测全部延迟
  const handleCheckAll = useStableCallback(
    useLockFn(async (groupName: string) => {
      debugLog(`[ProxyGroups] 开始测试所有延迟，组: ${groupName}`)

      const proxies = renderList
        .filter(
          (e) => e.group?.name === groupName && (e.type === 2 || e.type === 4),
        )
        .flatMap((e) => e.proxyCol || e.proxy!)
        .filter(Boolean)

      debugLog(`[ProxyGroups] 找到代理数量: ${proxies.length}`)

      const providers = new Set(
        proxies.map((p) => p!.provider!).filter(Boolean),
      )

      if (providers.size) {
        debugLog(`[ProxyGroups] 发现提供者，数量: ${providers.size}`)
        Promise.allSettled(
          [...providers].map((p) => healthcheckProxyProvider(p)),
        ).then(() => {
          debugLog(`[ProxyGroups] 提供者健康检查完成`)
          onProxies()
        })
      }

      const names = proxies.filter((p) => !p!.provider).map((p) => p!.name)
      debugLog(`[ProxyGroups] 过滤后需要测试的代理数量: ${names.length}`)

      const url = delayManager.getUrl(groupName)
      debugLog(`[ProxyGroups] 测试URL: ${url}, 超时: ${timeout}ms`)

      try {
        await Promise.race([
          delayManager.checkListDelay(names, groupName, timeout),
          delayGroup(groupName, url, timeout).then((result) => {
            debugLog(
              `[ProxyGroups] getGroupProxyDelays返回结果数量:`,
              Object.keys(result || {}).length,
            )
          }), // 查询group delays 将清除fixed(不关注调用结果)
        ])
        debugLog(`[ProxyGroups] 延迟测试完成，组: ${groupName}`)
      } catch (error) {
        console.error(`[ProxyGroups] 延迟测试出错，组: ${groupName}`, error)
      } finally {
        const headState = getGroupHeadState(groupName)
        if (headState?.sortType === 1) {
          onHeadState(groupName, { sortType: headState.sortType })
        }
        onProxies()
      }
    }),
  )

  // 滚到对应的节点
  const handleLocation = useStableCallback((group: IProxyGroupItem) => {
    if (!group) return
    const { name, now } = group

    const index = renderList.findIndex(
      (e) =>
        e.group?.name === name &&
        ((e.type === 2 && e.proxy?.name === now) ||
          (e.type === 4 && e.proxyCol?.some((p) => p.name === now))),
    )

    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
    }
  })

  // 定位到指定的代理组
  const handleGroupLocationByName = useCallback(
    (groupName: string) => {
      const index = renderList.findIndex(
        (item) => item.type === 0 && item.group?.name === groupName,
      )

      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })
      }
    },
    [renderList, virtualizer],
  )

  const proxyGroupNames = useMemo(() => {
    const names = renderList
      .filter((item) => item.type === 0 && item.group?.name)
      .map((item) => item.group!.name)
    return Array.from(new Set(names))
  }, [renderList])

  const renderProxyList = (height: string) => (
    <ProxyVirtualList
      parentRef={parentRef}
      height={height}
      totalSize={virtualizer.getTotalSize()}
      virtualItems={virtualItems}
      renderList={renderList}
      activeStickyIndex={activeStickyIndex}
      indent={mode === 'rule' || mode === 'script'}
      isChainMode={isChainMode}
      measureElement={virtualizer.measureElement}
      onLocation={handleLocation}
      onCheckAll={handleCheckAll}
      onHeadState={onHeadState}
      onChangeProxy={handleChangeProxy}
    />
  )

  if (mode === 'direct') {
    return <BaseEmpty textKey="proxies.page.messages.directMode" />
  }

  if (isChainMode) {
    // 获取所有代理组
    const proxyGroups = proxiesData?.groups || []
    const showRuleHeader = mode === 'rule' && proxyGroups.length > 0

    return (
      <>
        <Box sx={{ display: 'flex', height: '100%', gap: 2 }}>
          <Box sx={{ flex: 1, position: 'relative' }}>
            {showRuleHeader && (
              <ChainRuleHeader
                title={t('proxies.page.rules.title')}
                selectLabel={t('proxies.page.rules.select')}
                currentGroup={currentGroup}
                canSelectGroup={availableGroups.length > 0}
                onMenuOpen={handleGroupMenuOpen}
              />
            )}

            {renderProxyList(
              showRuleHeader ? 'calc(100% - 80px)' : 'calc(100% - 14px)',
            )}
            <ScrollTopButton show={showScrollTop} onClick={scrollToTop} />
          </Box>

          <Box sx={{ width: '400px', minWidth: '300px' }}>
            <ProxyChain
              proxyChain={proxyChain}
              onUpdateChain={setProxyChain}
              chainConfigData={chainConfigData}
              mode={mode}
              selectedGroup={activeSelectedGroup}
            />
          </Box>
        </Box>

        <Snackbar
          open={duplicateWarning.open}
          autoHideDuration={3000}
          onClose={handleCloseDuplicateWarning}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert
            onClose={handleCloseDuplicateWarning}
            severity="warning"
            variant="filled"
          >
            {duplicateWarning.message}
          </Alert>
        </Snackbar>

        <GroupSelectMenu
          anchorEl={ruleMenuAnchor}
          groups={availableGroups}
          selectedGroup={activeSelectedGroup}
          emptyText="暂无可用代理组"
          onClose={handleGroupMenuClose}
          onSelect={handleGroupSelect}
        />
      </>
    )
  }

  return (
    <div
      style={{ position: 'relative', height: '100%', willChange: 'transform' }}
    >
      {/* 代理组导航栏 */}
      {mode === 'rule' && (
        <ProxyGroupNavigator
          proxyGroupNames={proxyGroupNames}
          onGroupLocation={handleGroupLocationByName}
          enableHoverJump={verge?.enable_hover_jump_navigator ?? true}
          hoverDelay={verge?.hover_jump_navigator_delay ?? DEFAULT_HOVER_DELAY}
        />
      )}

      {renderProxyList('calc(100% - 14px)')}
      <ScrollTopButton show={showScrollTop} onClick={scrollToTop} />
    </div>
  )
}

type VirtualListItem = {
  key: Key
  index: number
  start: number
  end: number
}

interface ProxyVirtualListProps {
  parentRef: RefObject<HTMLDivElement | null>
  height: string
  totalSize: number
  virtualItems: VirtualListItem[]
  renderList: IRenderItem[]
  activeStickyIndex: number | null
  indent: boolean
  isChainMode?: boolean
  measureElement: (node: Element | null) => void
  onLocation: (group: IRenderItem['group']) => void
  onCheckAll: (groupName: string) => void
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
  onChangeProxy: (
    group: IRenderItem['group'],
    proxy: IRenderItem['proxy'] & { name: string },
  ) => void
}

interface ProxyGroupOption {
  name: string
  type: string
  all?: unknown[]
}

interface ChainRuleHeaderProps {
  title: string
  selectLabel: string
  currentGroup: ProxyGroupOption | null
  canSelectGroup: boolean
  onMenuOpen: (event: MouseEvent<HTMLElement>) => void
}

function ChainRuleHeader({
  title,
  selectLabel,
  currentGroup,
  canSelectGroup,
  onMenuOpen,
}: ChainRuleHeaderProps) {
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '16px' }}>
            {title}
          </Typography>

          {currentGroup && (
            <Chip
              size="small"
              label={`${currentGroup.name} (${currentGroup.type})`}
              variant="outlined"
              sx={{
                fontSize: '12px',
                maxWidth: '200px',
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            />
          )}
        </Box>

        {canSelectGroup && (
          <IconButton
            size="small"
            onClick={onMenuOpen}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '4px',
              padding: '4px 8px',
            }}
          >
            <Typography variant="body2" sx={{ mr: 0.5, fontSize: '12px' }}>
              {selectLabel}
            </Typography>
            <ExpandMoreRounded fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Box>
  )
}

interface GroupSelectMenuProps {
  anchorEl: HTMLElement | null
  groups: ProxyGroupOption[]
  selectedGroup: string | null
  emptyText: string
  onClose: () => void
  onSelect: (groupName: string) => void
}

function GroupSelectMenu({
  anchorEl,
  groups,
  selectedGroup,
  emptyText,
  onClose,
  onSelect,
}: GroupSelectMenuProps) {
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            maxHeight: 300,
            minWidth: 200,
          },
        },
      }}
    >
      {groups.map((group) => (
        <MenuItem
          key={group.name}
          onClick={() => onSelect(group.name)}
          selected={selectedGroup === group.name}
          sx={{ fontSize: '14px', py: 1 }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {group.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {group.type} · {group.all?.length ?? 0} 节点
            </Typography>
          </Box>
        </MenuItem>
      ))}

      {groups.length === 0 && (
        <MenuItem disabled>
          <Typography variant="body2" color="text.secondary">
            {emptyText}
          </Typography>
        </MenuItem>
      )}
    </Menu>
  )
}

function ProxyVirtualList({
  parentRef,
  height,
  totalSize,
  virtualItems,
  renderList,
  activeStickyIndex,
  indent,
  isChainMode,
  measureElement,
  onLocation,
  onCheckAll,
  onHeadState,
  onChangeProxy,
}: ProxyVirtualListProps) {
  const theme = useTheme()
  const stickyBackground =
    theme.palette.mode === 'dark' ? '#1e1f27' : 'var(--background-color)'

  return (
    <div ref={parentRef} style={{ height, overflow: 'auto' }}>
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={measureElement}
            style={{
              position:
                virtualItem.index === activeStickyIndex ? 'sticky' : 'absolute',
              top: 0,
              left: 0,
              zIndex: virtualItem.index === activeStickyIndex ? 5 : undefined,
              display:
                virtualItem.index === activeStickyIndex
                  ? 'flow-root'
                  : undefined,
              backgroundColor:
                virtualItem.index === activeStickyIndex
                  ? stickyBackground
                  : undefined,
              width: '100%',
              transform:
                virtualItem.index === activeStickyIndex
                  ? undefined
                  : `translateY(${virtualItem.start}px)`,
            }}
          >
            <ProxyRender
              item={renderList[virtualItem.index]}
              indent={indent}
              onLocation={onLocation}
              onCheckAll={onCheckAll}
              onHeadState={onHeadState}
              onChangeProxy={onChangeProxy}
              isChainMode={isChainMode}
            />
          </div>
        ))}
        <div style={{ height: 8 }} />
      </div>
    </div>
  )
}

// 替换简单防抖函数为更优的节流函数
function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let previous = 0
  let lastArgs: Parameters<T> | null = null

  const run = (args: Parameters<T>) => {
    previous = Date.now()
    timer = null
    lastArgs = null
    func(...args)
  }

  return function (...args: Parameters<T>) {
    const now = Date.now()
    const remaining = wait - (now - previous)
    lastArgs = args

    if (remaining <= 0 || remaining > wait) {
      if (timer) {
        clearTimeout(timer)
      }
      run(args)
    } else if (!timer) {
      timer = setTimeout(() => {
        if (lastArgs) {
          run(lastArgs)
        }
      }, remaining)
    }
  }
}
