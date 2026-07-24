import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findCurrentGroupMember,
  findGroup,
  getRecord,
  isInteractableMember,
  memberDetails,
  providerNameOf,
  rebindMemberOccurrence,
  rebindNode,
  resolveMember,
  selectGlobalChainNodes,
  selectRuleChainMembers,
  selectRuntimeStandaloneNodes,
  toMemberOccurrenceBinding,
  toNodeBinding,
} from '../src/types/proxy-view.ts'

const node = {
  recordId: 'p:0:0',
  name: 'provider-node',
  type: 'Shadowsocks',
  alive: true,
  history: [],
  udp: true,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  source: {
    kind: 'provider',
    providerName: 'provider-key',
    proxyName: 'provider-node',
  },
}

const group = {
  name: 'Group',
  type: 'Selector',
  alive: true,
  history: [],
  udp: true,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  members: [{ kind: 'node', name: node.name, recordId: node.recordId }],
}

const view = {
  schemaVersion: 1,
  orderSource: 'runtime',
  providerState: 'ready',
  global: null,
  direct: null,
  groups: [group],
  records: { [node.recordId]: node },
  standalone: [],
  providers: [],
}

test('resolves nodes only through recordId and preserves provider identity', () => {
  const resolved = resolveMember(view, group.members[0])
  assert.equal(resolved.kind, 'node')
  assert.equal(getRecord(view, 'p:0:0'), node)
  assert.equal(memberDetails(resolved), node)
  assert.equal(providerNameOf(node), 'provider-key')
  assert.equal(isInteractableMember(resolved), true)
})

test('finds group refs without constructing a name-keyed records map', () => {
  const resolved = resolveMember(view, { kind: 'group', name: 'Group' })
  assert.equal(resolved.kind, 'group')
  assert.equal(findGroup(view, 'Group'), group)
  assert.equal(memberDetails(resolved), group)
})

test('keeps unresolved members visible but non-interactable', () => {
  const resolved = resolveMember(view, {
    kind: 'unresolved',
    name: 'unknown',
    reason: 'provider-unavailable',
  })
  assert.deepEqual(resolved, {
    kind: 'unresolved',
    ref: {
      kind: 'unresolved',
      name: 'unknown',
      reason: 'provider-unavailable',
    },
  })
  assert.equal(isInteractableMember(resolved), false)
  assert.equal(memberDetails(resolved), undefined)
})

test('rebinds a node semantically when its response-scoped id moves', () => {
  const previous = resolveMember(view, group.members[0])
  assert.equal(previous.kind, 'node')

  const movedNode = { ...node, recordId: 'p:1:0' }
  const movedGroup = {
    ...group,
    members: [
      { kind: 'node', name: movedNode.name, recordId: movedNode.recordId },
    ],
  }
  const movedView = {
    ...view,
    groups: [movedGroup],
    records: { [movedNode.recordId]: movedNode },
  }
  const movedCandidates = movedGroup.members.map((member) => {
    const resolved = resolveMember(movedView, member)
    assert.equal(resolved.kind, 'node')
    return resolved.node
  })

  assert.equal(
    rebindNode(movedCandidates, toNodeBinding(previous.node))?.recordId,
    'p:1:0',
  )
  assert.equal(
    rebindNode(movedCandidates, { name: 'provider-node' })?.recordId,
    'p:1:0',
  )

  const duplicate = { ...movedNode, recordId: 'p:1:1' }
  assert.equal(
    rebindNode([movedNode, duplicate], toNodeBinding(previous.node)),
    undefined,
  )

  const sameNameOtherSource = {
    ...movedNode,
    recordId: 'p:2:0',
    source: { ...movedNode.source, providerName: 'other-provider' },
  }
  assert.equal(
    rebindNode([movedNode, sameNameOtherSource], {
      name: 'provider-node',
    }),
    undefined,
  )
})

test('keeps a runtime core node that is absent from GLOBAL as standalone', () => {
  const runtimeOnly = {
    ...node,
    recordId: 'c:0',
    name: 'runtime-only',
    source: { kind: 'core', proxyName: 'runtime-only' },
  }
  const excluded = {
    ...runtimeOnly,
    recordId: 'c:1',
    name: 'not-in-runtime',
    source: { kind: 'core', proxyName: 'not-in-runtime' },
  }
  const standaloneView = {
    ...view,
    global: { ...group, name: 'GLOBAL', members: [] },
    records: { 'c:0': runtimeOnly, 'c:1': excluded },
    standalone: ['c:0', 'c:1'],
  }

  assert.deepEqual(
    selectRuntimeStandaloneNodes(standaloneView, [{ name: 'runtime-only' }]),
    [runtimeOnly],
  )
  assert.deepEqual(
    selectGlobalChainNodes(standaloneView, [{ name: 'runtime-only' }]),
    [runtimeOnly],
  )
})

test('does not expose global-chain candidates without GLOBAL', () => {
  const runtimeOnly = {
    ...node,
    recordId: 'c:0',
    name: 'runtime-only',
    source: { kind: 'core', proxyName: 'runtime-only' },
  }
  const globalMissingView = {
    ...view,
    global: null,
    records: { 'c:0': runtimeOnly },
    standalone: ['c:0'],
  }

  assert.deepEqual(
    selectGlobalChainNodes(globalMissingView, [{ name: 'runtime-only' }]),
    [],
  )
})

test('does not fall back to global nodes when a selected rule group disappears', () => {
  assert.deepEqual(selectRuleChainMembers(view, 'removed-group'), [])
})

test('uses the current backend group selection after ids and now change', () => {
  const previousNode = {
    ...node,
    recordId: 'p:0:0',
    name: 'previous-node',
    source: { ...node.source, proxyName: 'previous-node' },
  }
  const nextNode = {
    ...node,
    recordId: 'p:0:1',
    name: 'next-node',
    source: { ...node.source, proxyName: 'next-node' },
  }
  const firstGroup = {
    ...group,
    now: previousNode.name,
    members: [
      {
        kind: 'node',
        name: previousNode.name,
        recordId: previousNode.recordId,
      },
      { kind: 'node', name: nextNode.name, recordId: nextNode.recordId },
    ],
  }
  const firstView = {
    ...view,
    groups: [firstGroup],
    records: {
      [previousNode.recordId]: previousNode,
      [nextNode.recordId]: nextNode,
    },
  }

  assert.equal(
    findCurrentGroupMember(firstView, firstGroup).member.node.recordId,
    previousNode.recordId,
  )

  const movedPrevious = { ...previousNode, recordId: 'p:1:1' }
  const movedNext = { ...nextNode, recordId: 'p:1:0' }
  const refreshedGroup = {
    ...firstGroup,
    now: movedNext.name,
    members: [
      { kind: 'node', name: movedNext.name, recordId: movedNext.recordId },
      {
        kind: 'node',
        name: movedPrevious.name,
        recordId: movedPrevious.recordId,
      },
    ],
  }
  const refreshedView = {
    ...firstView,
    groups: [refreshedGroup],
    records: {
      [movedNext.recordId]: movedNext,
      [movedPrevious.recordId]: movedPrevious,
    },
  }

  const current = findCurrentGroupMember(refreshedView, refreshedGroup)
  assert.equal(current.member.ref.name, movedNext.name)
  assert.equal(current.member.node.recordId, movedNext.recordId)

  const unresolvedGroup = {
    ...refreshedGroup,
    now: 'unresolved-node',
    members: [
      {
        kind: 'unresolved',
        name: 'unresolved-node',
        reason: 'provider-unavailable',
      },
      ...refreshedGroup.members,
    ],
  }
  assert.equal(
    findCurrentGroupMember(
      { ...refreshedView, groups: [unresolvedGroup] },
      unresolvedGroup,
    ),
    undefined,
  )
  assert.equal(
    findCurrentGroupMember(refreshedView, {
      ...refreshedGroup,
      now: undefined,
    }),
    undefined,
  )
  assert.equal(
    findCurrentGroupMember(refreshedView, {
      ...refreshedGroup,
      now: 'missing-node',
    }),
    undefined,
  )
})

test('rebinds a semantic member occurrence across id and index rotation', () => {
  const firstDuplicate = node
  const secondDuplicate = { ...node, recordId: 'p:0:1' }
  const firstMembers = [
    resolveMember(view, group.members[0]),
    {
      kind: 'group',
      ref: { kind: 'group', name: group.name },
      group,
    },
    {
      kind: 'node',
      ref: {
        kind: 'node',
        name: secondDuplicate.name,
        recordId: secondDuplicate.recordId,
      },
      node: secondDuplicate,
    },
  ]

  const binding = toMemberOccurrenceBinding(firstMembers, 2)
  assert.deepEqual(binding, {
    kind: 'node',
    name: node.name,
    source: node.source,
    occurrence: 1,
  })
  const groupBinding = toMemberOccurrenceBinding(firstMembers, 1)
  assert.deepEqual(groupBinding, {
    kind: 'group',
    name: group.name,
    occurrence: 0,
  })

  const movedFirst = { ...firstDuplicate, recordId: 'p:1:0' }
  const movedSecond = { ...secondDuplicate, recordId: 'p:1:1' }
  const refreshedMembers = [
    {
      kind: 'group',
      ref: { kind: 'group', name: group.name },
      group,
    },
    {
      kind: 'node',
      ref: {
        kind: 'node',
        name: movedFirst.name,
        recordId: movedFirst.recordId,
      },
      node: movedFirst,
    },
    {
      kind: 'unresolved',
      ref: { kind: 'unresolved', name: node.name, reason: 'ambiguous' },
    },
    {
      kind: 'node',
      ref: {
        kind: 'node',
        name: movedSecond.name,
        recordId: movedSecond.recordId,
      },
      node: movedSecond,
    },
  ]

  const rebound = rebindMemberOccurrence(refreshedMembers, binding)
  assert.equal(rebound.memberIndex, 3)
  assert.equal(rebound.member.node.recordId, movedSecond.recordId)
  assert.equal(
    rebindMemberOccurrence(refreshedMembers, groupBinding).memberIndex,
    0,
  )
})

test('rejects missing, unresolved, or missing duplicate occurrences', () => {
  const firstDuplicate = resolveMember(view, group.members[0])
  const secondNode = { ...node, recordId: 'p:0:1' }
  const secondDuplicate = {
    kind: 'node',
    ref: {
      kind: 'node',
      name: secondNode.name,
      recordId: secondNode.recordId,
    },
    node: secondNode,
  }
  const binding = toMemberOccurrenceBinding(
    [firstDuplicate, secondDuplicate],
    1,
  )

  assert.equal(
    rebindMemberOccurrence(
      [
        {
          kind: 'unresolved',
          ref: { kind: 'unresolved', name: node.name, reason: 'ambiguous' },
        },
      ],
      binding,
    ),
    undefined,
  )
  assert.equal(rebindMemberOccurrence([firstDuplicate], binding), undefined)
  assert.equal(
    toMemberOccurrenceBinding(
      [
        {
          kind: 'unresolved',
          ref: { kind: 'unresolved', name: node.name, reason: 'missing' },
        },
      ],
      0,
    ),
    undefined,
  )
})
