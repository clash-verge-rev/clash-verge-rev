import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findGroup,
  getRecord,
  isInteractableMember,
  memberDetails,
  providerNameOf,
  rebindNode,
  resolveMember,
  selectRuntimeStandaloneNodes,
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
    members: [{ kind: 'node', name: movedNode.name, recordId: movedNode.recordId }],
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
})
