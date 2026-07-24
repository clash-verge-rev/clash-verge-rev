export interface ProxyViewV1 {
  schemaVersion: 1
  orderSource: 'runtime' | 'fallback'
  providerState: 'ready' | 'unavailable'
  global: ProxyGroupView | null
  direct: string | null
  groups: ProxyGroupView[]
  records: Record<string, ProxyNodeView>
  standalone: string[]
  providers: ProxyProviderView[]
}

interface ProxyCapabilities {
  udp: boolean
  xudp: boolean
  tfo: boolean
  mptcp: boolean
  smux: boolean
}

interface DelayHistory {
  time: string
  delay: number
}

export interface ProxyGroupView extends ProxyCapabilities {
  name: string
  type: string
  alive: boolean
  now?: string
  fixed?: string
  hidden?: boolean
  icon?: string
  testUrl?: string
  history: DelayHistory[]
  members: ProxyMemberRef[]
}

export interface ProxyNodeView extends ProxyCapabilities {
  recordId: string
  name: string
  type: string
  alive: boolean
  history: DelayHistory[]
  id?: string
  hidden?: boolean
  icon?: string
  testUrl?: string
  source:
    | { kind: 'core'; proxyName: string }
    | { kind: 'provider'; providerName: string; proxyName: string }
}

type ProxyMemberUnresolvedReason =
  | 'missing'
  | 'ambiguous'
  | 'provider-unavailable'

export type ProxyMemberRef =
  | { kind: 'group'; name: string }
  | { kind: 'node'; name: string; recordId: string }
  | {
      kind: 'unresolved'
      name: string
      reason: ProxyMemberUnresolvedReason
    }

interface ProxyProviderView {
  name: string
  vehicleType: 'HTTP' | 'File'
  updatedAt?: string
  subscriptionInfo?: ProxySubscriptionInfo
  proxyRecordIds: string[]
}

interface ProxySubscriptionInfo {
  upload: number
  download: number
  total: number
  expire: number
}

export type ResolvedProxyMember =
  | {
      kind: 'group'
      ref: Extract<ProxyMemberRef, { kind: 'group' }>
      group: ProxyGroupView
    }
  | {
      kind: 'node'
      ref: Extract<ProxyMemberRef, { kind: 'node' }>
      node: ProxyNodeView
    }
  | {
      kind: 'unresolved'
      ref: Extract<ProxyMemberRef, { kind: 'unresolved' }>
    }

export type InteractableProxyMember = Exclude<
  ResolvedProxyMember,
  { kind: 'unresolved' }
>

export interface ProxyNodeBinding {
  name: string
  source?: ProxyNodeView['source']
}

export type ProxyMemberOccurrenceBinding =
  | { kind: 'group'; name: string; occurrence: number }
  | {
      kind: 'node'
      name: string
      source: ProxyNodeView['source']
      occurrence: number
    }

export interface InteractableProxyMemberOccurrence {
  memberIndex: number
  member: InteractableProxyMember
}

export const getRecord = (view: ProxyViewV1, recordId: string) =>
  view.records[recordId]

const findGroup = (view: ProxyViewV1, name: string) =>
  view.global?.name === name
    ? view.global
    : view.groups.find((group) => group.name === name)

export function resolveMember(
  view: ProxyViewV1,
  member: ProxyMemberRef,
): ResolvedProxyMember {
  if (member.kind === 'unresolved') {
    return { kind: 'unresolved', ref: member }
  }
  if (member.kind === 'group') {
    const group = findGroup(view, member.name)
    if (!group) throw new Error('Proxy view group not found: ' + member.name)
    return { kind: 'group', ref: member, group }
  }

  const node = getRecord(view, member.recordId)
  if (!node) {
    throw new Error('Proxy view record not found: ' + member.recordId)
  }
  return { kind: 'node', ref: member, node }
}

export const isInteractableMember = (
  member: ResolvedProxyMember,
): member is InteractableProxyMember => member.kind !== 'unresolved'

export const memberDetails = (member: ResolvedProxyMember) =>
  member.kind === 'node'
    ? member.node
    : member.kind === 'group'
      ? member.group
      : undefined

export function findCurrentGroupMember(
  view: ProxyViewV1,
  group: ProxyGroupView,
): InteractableProxyMemberOccurrence | undefined {
  if (!group.now) return undefined

  for (const [memberIndex, memberRef] of group.members.entries()) {
    const member = resolveMember(view, memberRef)
    if (isInteractableMember(member) && member.ref.name === group.now) {
      return { memberIndex, member }
    }
  }

  return undefined
}

export const providerNameOf = (node: ProxyNodeView) =>
  node.source.kind === 'provider' ? node.source.providerName : undefined

const resolveStandaloneNodes = (view: ProxyViewV1) =>
  view.standalone.map((recordId) => {
    const node = getRecord(view, recordId)
    if (!node) throw new Error('Proxy view record not found: ' + recordId)
    return node
  })

const selectRuntimeStandaloneNodes = (
  view: ProxyViewV1,
  runtimeProxies: unknown,
) => {
  const runtimeProxyNames = new Set(
    (Array.isArray(runtimeProxies) ? runtimeProxies : []).flatMap((proxy) => {
      const name =
        typeof proxy === 'object' && proxy !== null && 'name' in proxy
          ? proxy.name
          : undefined
      return typeof name === 'string' && name.length > 0 ? [name] : []
    }),
  )
  return resolveStandaloneNodes(view).filter(
    (node) =>
      node.source.kind === 'core' &&
      runtimeProxyNames.has(node.source.proxyName),
  )
}

export const selectGlobalChainNodes = (
  view: ProxyViewV1,
  runtimeProxies: unknown,
) =>
  view.global === null ? [] : selectRuntimeStandaloneNodes(view, runtimeProxies)

export const selectRuleChainMembers = (
  view: ProxyViewV1,
  groupName: string,
): Array<{ memberIndex: number; member: ResolvedProxyMember }> => {
  const group = view.groups.find(({ name }) => name === groupName)
  if (!group) return []

  return group.members.flatMap((memberRef, memberIndex) => {
    const member = resolveMember(view, memberRef)
    return member.kind === 'group' ? [] : [{ memberIndex, member }]
  })
}

const sameSource = (
  left: ProxyNodeView['source'],
  right: ProxyNodeView['source'],
) =>
  left.kind === right.kind &&
  left.proxyName === right.proxyName &&
  (left.kind === 'core' ||
    (right.kind === 'provider' && left.providerName === right.providerName))

const matchesMemberBinding = (
  member: ResolvedProxyMember,
  binding: ProxyMemberOccurrenceBinding,
) =>
  member.kind === binding.kind &&
  member.ref.name === binding.name &&
  (member.kind !== 'node' ||
    (binding.kind === 'node' && sameSource(member.node.source, binding.source)))

export function toMemberOccurrenceBinding(
  members: readonly ResolvedProxyMember[],
  memberIndex: number,
): ProxyMemberOccurrenceBinding | undefined {
  const member = members[memberIndex]
  if (!member || !isInteractableMember(member)) return undefined

  const binding: ProxyMemberOccurrenceBinding =
    member.kind === 'node'
      ? {
          kind: 'node',
          name: member.ref.name,
          source: member.node.source,
          occurrence: 0,
        }
      : { kind: 'group', name: member.ref.name, occurrence: 0 }

  for (let index = 0; index < memberIndex; index += 1) {
    if (matchesMemberBinding(members[index], binding)) {
      binding.occurrence += 1
    }
  }

  return binding
}

export function rebindMemberOccurrence(
  members: readonly ResolvedProxyMember[],
  binding: ProxyMemberOccurrenceBinding,
): InteractableProxyMemberOccurrence | undefined {
  let occurrence = 0

  for (const [memberIndex, member] of members.entries()) {
    if (
      !isInteractableMember(member) ||
      !matchesMemberBinding(member, binding)
    ) {
      continue
    }
    if (occurrence === binding.occurrence) return { memberIndex, member }
    occurrence += 1
  }

  return undefined
}

export function rebindNode(
  candidates: readonly ProxyNodeView[],
  binding: ProxyNodeBinding,
) {
  const matches = candidates.filter(
    (node) =>
      node.name === binding.name &&
      (binding.source === undefined || sameSource(node.source, binding.source)),
  )
  const unique = new Map(matches.map((node) => [node.recordId, node]))
  return unique.size === 1 ? unique.values().next().value : undefined
}
