import { useEffect, useMemo, useRef } from 'react'

import { useRuntimeConfig } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import {
  isInteractableMember,
  resolveMember,
  selectGlobalChainNodes,
  selectRuleChainMembers,
  type ProxyGroupView,
  type ProxyViewV1,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

import { filterSort } from './use-filter-sort'
import {
  DEFAULT_STATE,
  useHeadStateNew,
  type HeadState,
} from './use-head-state'
import { useWindowWidth } from './use-window-width'

export interface ResolvedMemberOccurrence {
  memberIndex: number
  member: ResolvedProxyMember
}

type ProxyGroup = ProxyGroupView

export interface IRenderItem {
  type: 0 | 1 | 2 | 3 | 4
  key: string
  group: ProxyGroup
  member?: ResolvedMemberOccurrence
  memberCol?: ResolvedMemberOccurrence[]
  col?: number
  headState?: HeadState
  icon?: string
  testUrl?: string
}

type GroupCache = {
  now: string | undefined
  members: ProxyGroupView['members']
  headState: HeadState
  col: number
  latencyTimeout: number | undefined
  items: IRenderItem[]
}

type RuntimeConfigWithProxySequence = IConfigData & { proxies?: unknown }

const resolveOccurrences = (view: ProxyViewV1, group: ProxyGroupView) =>
  group.members.map((member, memberIndex) => ({
    memberIndex,
    member: resolveMember(view, member),
  }))

const memberKey = (
  group: ProxyGroupView,
  occurrence: ResolvedMemberOccurrence,
) => {
  const { memberIndex, member } = occurrence
  const identity =
    member.kind === 'node' ? member.node.recordId : member.ref.name
  return `${group.name}:${memberIndex}:${identity}`
}

const calculateColumns = (width: number, configCol: number): number => {
  if (configCol > 0 && configCol < 6) return configCol
  if (width > 1920) return 5
  if (width > 1450) return 4
  if (width > 1024) return 3
  if (width >= 600) return 2
  return 1
}

const groupOccurrences = <T>(list: T[], size: number): T[][] =>
  list.reduce<T[][]>((acc, item) => {
    const lastGroup = acc[acc.length - 1]
    if (!lastGroup || lastGroup.length >= size) acc.push([item])
    else lastGroup.push(item)
    return acc
  }, [])

const CHAIN_DELAY_GROUP = 'chain-mode'

const virtualGroup = (members: ProxyGroupView['members']): ProxyGroupView => ({
  name: CHAIN_DELAY_GROUP,
  type: 'Selector',
  alive: true,
  udp: false,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  history: [],
  members,
})

export const useRenderList = (
  mode: string,
  isChainMode?: boolean,
  selectedGroup?: string | null,
) => {
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const { verge } = useVerge()
  const { width } = useWindowWidth()
  const [headStates, setHeadState] = useHeadStateNew()
  const latencyTimeout = verge?.default_latency_timeout
  const { data: runtimeConfig } = useRuntimeConfig(!!isChainMode)
  const runtimeProxies = (
    runtimeConfig as RuntimeConfigWithProxySequence | null
  )?.proxies

  const col = useMemo(
    () => calculateColumns(width, verge?.proxy_layout_column || 6),
    [width, verge?.proxy_layout_column],
  )

  const chainOccurrences = useMemo(() => {
    if (!proxyView || !isChainMode) return []
    if (mode === 'rule' && selectedGroup) {
      return selectRuleChainMembers(proxyView, selectedGroup)
    }
    if (!runtimeConfig) return []
    return selectGlobalChainNodes(proxyView, runtimeProxies).map(
      (node, memberIndex) => ({
        memberIndex,
        member: {
          kind: 'node' as const,
          ref: {
            kind: 'node' as const,
            name: node.name,
            recordId: node.recordId,
          },
          node,
        },
      }),
    )
  }, [
    isChainMode,
    mode,
    proxyView,
    runtimeConfig,
    runtimeProxies,
    selectedGroup,
  ])

  const chainOccurrencesRef = useRef(chainOccurrences)
  chainOccurrencesRef.current = chainOccurrences
  const chainDelayGroup =
    mode === 'rule' && selectedGroup ? selectedGroup : CHAIN_DELAY_GROUP
  const chainDelayKey = chainOccurrences
    .map(({ member }) => {
      if (member.kind !== 'node') return `${member.kind}:${member.ref.name}`
      const source = member.node.source
      return source.kind === 'provider'
        ? `provider:${source.providerName}:${source.proxyName}`
        : `core:${source.proxyName}`
    })
    .join('\u0000')

  useEffect(() => {
    if (!isChainMode || !chainDelayKey) return
    const interactable = chainOccurrencesRef.current
      .map(({ member }) => member)
      .filter(isInteractableMember)
    if (interactable.length === 0) return

    const handle = setTimeout(() => {
      const timeout = verge?.default_latency_timeout || 10000
      debugLog(`[ChainMode] 开始计算 ${interactable.length} 个节点的延迟`)
      void delayManager.checkListDelay(interactable, chainDelayGroup, timeout)
    }, 100)

    return () => {
      clearTimeout(handle)
    }
  }, [
    chainDelayGroup,
    chainDelayKey,
    isChainMode,
    verge?.default_latency_timeout,
  ])

  const groupCacheRef = useRef<Map<string, GroupCache>>(new Map())
  const prevListRef = useRef<IRenderItem[]>([])

  const renderList = useMemo<IRenderItem[]>(() => {
    if (!proxyView) return []

    if (isChainMode) {
      const selected =
        mode === 'rule'
          ? proxyView.groups.find(({ name }) => name === selectedGroup)
          : undefined
      const group = selected ?? virtualGroup([])
      const occurrences = filterSort(
        chainOccurrences,
        selected?.name ?? CHAIN_DELAY_GROUP,
        '',
        0,
        latencyTimeout,
      )
      if (col > 1) {
        return groupOccurrences(occurrences, col).map((memberCol) => ({
          type: 4,
          key: `chain-col:${memberKey(group, memberCol[0])}`,
          group,
          headState: DEFAULT_STATE,
          col,
          memberCol,
        }))
      }
      return occurrences.map((member) => ({
        type: 2,
        key: `chain:${memberKey(group, member)}`,
        group,
        member,
        headState: DEFAULT_STATE,
      }))
    }

    const useRule = mode === 'rule' || mode === 'script'
    const renderGroups = useRule
      ? proxyView.groups
      : proxyView.global === null
        ? []
        : [proxyView.global]
    const cache = groupCacheRef.current
    let anyChanged = false

    const retList = renderGroups.flatMap((group) => {
      const headState = headStates[group.name] || DEFAULT_STATE
      const cached = cache.get(group.name)
      if (
        cached &&
        cached.now === group.now &&
        cached.members === group.members &&
        cached.headState === headState &&
        cached.col === col &&
        cached.latencyTimeout === latencyTimeout
      ) {
        return cached.items
      }

      anyChanged = true
      const ret: IRenderItem[] = [
        {
          type: 0,
          key: group.name,
          group,
          headState,
          icon: group.icon,
          testUrl: group.testUrl,
        },
      ]

      if (headState.open || !useRule) {
        const occurrences = filterSort(
          resolveOccurrences(proxyView, group),
          group.name,
          headState.filterText,
          headState.sortType,
          latencyTimeout,
          {
            matchCase: headState.filterMatchCase,
            matchWholeWord: headState.filterMatchWholeWord,
            useRegularExpression: headState.filterUseRegularExpression,
          },
        )
        if (!useRule) {
          ret.push({ type: 1, key: `head-${group.name}`, group, headState })
        }
        if (occurrences.length === 0) {
          ret.push({ type: 3, key: `empty-${group.name}`, group, headState })
        } else if (col > 1) {
          ret.push(
            ...groupOccurrences(occurrences, col).map((memberCol) => ({
              type: 4 as const,
              key: `col:${memberKey(group, memberCol[0])}`,
              group,
              headState,
              col,
              memberCol,
            })),
          )
        } else {
          ret.push(
            ...occurrences.map((member) => ({
              type: 2 as const,
              key: memberKey(group, member),
              group,
              member,
              headState,
            })),
          )
        }
      }

      cache.set(group.name, {
        now: group.now,
        members: group.members,
        headState,
        col,
        latencyTimeout,
        items: ret,
      })
      return ret
    })

    const filtered = !useRule
      ? retList.slice(1)
      : retList.filter((item) => !item.group.hidden)
    if (!anyChanged && prevListRef.current.length === filtered.length) {
      return prevListRef.current
    }
    prevListRef.current = filtered
    return filtered
  }, [
    chainOccurrences,
    col,
    headStates,
    isChainMode,
    latencyTimeout,
    mode,
    proxyView,
    selectedGroup,
  ])

  return {
    renderList,
    onProxies: refreshProxy,
    onHeadState: setHeadState,
    currentColumns: col,
  }
}
