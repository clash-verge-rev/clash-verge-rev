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
import {
  type Key,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { useProxiesData } from '@/providers/app-data-context'
import { updateProxyChainConfigInRuntime } from '@/services/cmds'
import {
  isInteractableMember,
  type ProxyGroupView,
  type ResolvedProxyMember,
} from '@/types/proxy-view'

import { ScrollTopButton } from '../layout/scroll-top-button'

import { ProxyChain } from './proxy-chain'
import { type ProxyChainItem, rebindProxyChainItems } from './proxy-chain-model'
import { ProxyRender } from './proxy-render'
import type { HeadState } from './use-head-state'
import type { IRenderItem } from './use-render-list'

// ---- Types ----

type VirtualListItem = {
  key: Key
  index: number
  start: number
  end: number
}

type ProxyGroupOption = ProxyGroupView

// ---- Props ----

interface ChainRuleHeaderProps {
  title: string
  selectLabel: string
  currentGroup: ProxyGroupOption | null
  canSelectGroup: boolean
  onMenuOpen: (event: MouseEvent<HTMLElement>) => void
}

interface GroupSelectMenuProps {
  anchorEl: HTMLElement | null
  groups: ProxyGroupOption[]
  selectedGroup: string | null
  emptyText: string
  onClose: () => void
  onSelect: (groupName: string) => void
}

interface ProxyGroupsChainProps {
  mode: string
  chainConfigData?: string | null
  availableGroups: any[]
  activeSelectedGroup: string | null
  showScrollTop: boolean

  // Virtual list data (from parent's virtualizer)
  parentRef: RefObject<HTMLDivElement | null>
  totalSize: number
  virtualItems: VirtualListItem[]
  renderList: IRenderItem[]
  activeStickyIndex: number | null
  measureElement: (node: Element | null) => void

  // Shared callbacks
  onCheckAll: (groupName: string) => void
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
  onLocation: (group: any) => void
  onGroupSelect: (groupName: string) => void
  onScrollToTop: () => void
}

// ---- Sub-components ----

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
              {group.type} · {group.members.length} 节点
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
  isChainMode,
  measureElement,
  onLocation,
  onCheckAll,
  onHeadState,
  onChangeProxy,
}: {
  parentRef: RefObject<HTMLDivElement | null>
  height: string
  totalSize: number
  virtualItems: VirtualListItem[]
  renderList: IRenderItem[]
  activeStickyIndex: number | null
  isChainMode?: boolean
  measureElement: (node: Element | null) => void
  onLocation: (group: any) => void
  onCheckAll: (groupName: string) => void
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
  onChangeProxy: (group: ProxyGroupView, member: ResolvedProxyMember) => void
}) {
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

// ---- Main Chain Component ----

export function ProxyGroupsChain(props: ProxyGroupsChainProps) {
  const { t } = useTranslation()
  const {
    mode,
    chainConfigData,
    availableGroups,
    activeSelectedGroup,
    showScrollTop,
    parentRef,
    totalSize,
    virtualItems,
    renderList,
    activeStickyIndex,
    measureElement,
    onCheckAll,
    onHeadState,
    onLocation,
    onGroupSelect,
    onScrollToTop,
  } = props
  const { proxyView } = useProxiesData()

  // Chain-specific state
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

  const candidateNodes = useMemo(
    () =>
      renderList.flatMap((item) => {
        const occurrences = item.memberCol ?? (item.member ? [item.member] : [])
        return occurrences.flatMap(({ member }) =>
          member.kind === 'node' ? [member.node] : [],
        )
      }),
    [renderList],
  )

  const currentProxyChain = useMemo(
    () =>
      proxyView
        ? rebindProxyChainItems(proxyChain, candidateNodes, proxyView)
        : proxyChain.map((item) => ({
            ...item,
            recordId: undefined,
            delay: undefined,
          })),
    [candidateNodes, proxyChain, proxyView],
  )

  useEffect(() => {
    if (currentProxyChain.length > 0) {
      const persistedChain = currentProxyChain.map(
        ({ id, name, type, delay }) => ({
          id,
          name,
          type,
          delay,
        }),
      )
      localStorage.setItem('proxy-chain-items', JSON.stringify(persistedChain))
    } else {
      localStorage.removeItem('proxy-chain-items')
    }
  }, [currentProxyChain])

  const [ruleMenuAnchor, setRuleMenuAnchor] = useState<null | HTMLElement>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<{
    open: boolean
    message: string
  }>({ open: false, message: '' })

  // Compute current group for rule header
  const currentGroup = useMemo(() => {
    if (!activeSelectedGroup) return null
    return (
      availableGroups.find(
        (group: ProxyGroupView) => group.name === activeSelectedGroup,
      ) ?? null
    )
  }, [activeSelectedGroup, availableGroups])

  // Handlers
  const handleGroupMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setRuleMenuAnchor(event.currentTarget)
  }

  const handleGroupMenuClose = () => {
    setRuleMenuAnchor(null)
  }

  const handleGroupSelect = (groupName: string) => {
    onGroupSelect(groupName)
    handleGroupMenuClose()

    if (mode === 'rule') {
      updateProxyChainConfigInRuntime(null)
      localStorage.removeItem('proxy-chain-group')
      localStorage.removeItem('proxy-chain-exit-node')
      localStorage.removeItem('proxy-chain-items')
      setProxyChain([])
    }
  }

  const handleCloseDuplicateWarning = useCallback(() => {
    setDuplicateWarning({ open: false, message: '' })
  }, [])

  const handleChangeProxy = useCallback(
    (_group: ProxyGroupView, member: ResolvedProxyMember) => {
      if (!isInteractableMember(member) || member.kind !== 'node') return
      const { node } = member
      setProxyChain((prev) => {
        const current = proxyView
          ? rebindProxyChainItems(prev, candidateNodes, proxyView)
          : prev
        if (
          current.some(
            (item) =>
              item.recordId !== undefined && item.recordId === node.recordId,
          )
        ) {
          const warningMessage = t('proxies.page.chain.duplicateNode')
          setDuplicateWarning({
            open: true,
            message: warningMessage,
          })
          return prev // 返回原来的状态，不做任何更改
        }

        // 安全获取延迟数据，如果没有延迟数据则设为 undefined
        const delay =
          node.history.length > 0
            ? node.history[node.history.length - 1].delay
            : undefined

        const chainItem: ProxyChainItem = {
          id: `${node.name}_${Date.now()}`,
          name: node.name,
          recordId: node.recordId,
          source: node.source,
          type: node.type,
          delay,
        }

        return [...current, chainItem]
      })
    },
    [candidateNodes, proxyView, t],
  )

  // Render virtual list for chain mode
  const renderProxyList = (height: string) => (
    <ProxyVirtualList
      parentRef={parentRef}
      height={height}
      totalSize={totalSize}
      virtualItems={virtualItems}
      renderList={renderList}
      activeStickyIndex={activeStickyIndex}
      isChainMode
      measureElement={measureElement}
      onLocation={onLocation}
      onCheckAll={onCheckAll}
      onHeadState={onHeadState}
      onChangeProxy={handleChangeProxy}
    />
  )

  const showRuleHeader = mode === 'rule' && availableGroups.length > 0

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
          <ScrollTopButton show={showScrollTop} onClick={onScrollToTop} />
        </Box>

        <Box sx={{ width: '400px', minWidth: '300px' }}>
          <ProxyChain
            proxyChain={currentProxyChain}
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
