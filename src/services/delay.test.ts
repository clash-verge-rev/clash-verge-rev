import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('tauri-plugin-mihomo-api', () => ({
  delayProxyByName: vi.fn(async () => ({ delay: 120 })),
  healthcheckNodeInProvider: vi.fn(async () => ({ delay: 120 })),
}))

import type { ResolvedProxyMember } from '@/types/proxy-view'

import delayManager from './delay'

const node = (name: string) =>
  ({
    kind: 'node',
    ref: { kind: 'node', name, recordId: `r:${name}` },
    node: {
      recordId: `r:${name}`,
      name,
      history: [],
      source: { kind: 'core', proxyName: name },
    },
  }) as unknown as ResolvedProxyMember

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let settles = 0
let unsubscribe: () => void

beforeEach(() => {
  settles = 0
  unsubscribe = delayManager.addGroupListener('g', () => {
    settles += 1
  })
})

afterEach(() => unsubscribe())

describe('group delay completion', () => {
  test('notifies once after a batch settles', async () => {
    const proxies = Array.from({ length: 6 }, (_, index) => node(`n${index}`))

    await delayManager.checkListDelay(proxies as never, 'g', 5000, 2)
    await flush()

    expect(settles).toBe(1)
  })

  test('notifies only listeners for the completed group', async () => {
    let other = 0
    const stop = delayManager.addGroupListener('other', () => {
      other += 1
    })

    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await flush()

    expect(settles).toBe(1)
    expect(other).toBe(0)
    stop()
  })
})

test('uses newer core history after a tray test without hiding an active page test', () => {
  const member = node('tray-refresh')
  if (member.kind !== 'node') throw new Error('Expected node')
  const cached = delayManager.setDelay(member, 'tray-group', 50)
  member.node.extra = {
    [delayManager.getUrl('tray-group')]: {
      alive: true,
      history: [
        { time: new Date(cached.updatedAt + 1000).toISOString(), delay: 300 },
      ],
    },
  }

  expect(delayManager.getDelayFix(member, 'tray-group')).toBe(300)
  expect(delayManager.getDelayUpdate(member, 'tray-group')?.delay).toBe(300)

  delayManager.setDelay(member, 'tray-group', -2)
  expect(delayManager.getDelayFix(member, 'tray-group')).toBe(-2)
})

test('latency URL validation rejects malformed hosts and ports and trims valid URLs', () => {
  for (const url of [
    'http://?',
    'http://host:invalid',
    'http://bad host/',
    'ftp://localhost',
    'http:localhost',
  ]) {
    delayManager.setUrl('url-validation', url)
    expect(delayManager.getUrl('url-validation')).toBe(
      'http://cp.cloudflare.com/generate_204',
    )
  }
  delayManager.setUrl('url-validation', ' HTTP://localhost:8080/ ')
  expect(delayManager.getUrl('url-validation')).toBe('HTTP://localhost:8080/')
})

test('another URL cannot replace a group measurement, but a newer matching URL can', () => {
  const member = node('url-isolation')
  if (member.kind !== 'node') throw new Error('Expected node')
  delayManager.setUrl('url-a', 'http://localhost/a')
  const cached = delayManager.setDelay(member, 'url-a', 50)
  const newer = new Date(cached.updatedAt + 1000).toISOString()
  Object.assign(member.node, {
    history: [{ time: newer, delay: 126 }],
    extra: {
      'http://localhost/a': {
        alive: true,
        history: [
          { time: new Date(cached.updatedAt - 1000).toISOString(), delay: 49 },
        ],
      },
      'http://localhost/b': {
        alive: true,
        history: [{ time: newer, delay: 126 }],
      },
    },
  })
  expect(delayManager.getDelayFix(member, 'url-a')).toBe(50)
  Object.assign(member.node, {
    extra: {
      'http://localhost/a': {
        alive: true,
        history: [{ time: newer, delay: 75 }],
      },
    },
  })
  expect(delayManager.getDelayFix(member, 'url-a')).toBe(75)
})

test('same-named provider members keep separate measurements and listeners', async () => {
  const first = node('same-provider-name')
  const second = node('same-provider-name')
  if (first.kind !== 'node' || second.kind !== 'node')
    throw new Error('Expected nodes')
  first.node.recordId = 'provider-a:N'
  first.node.source = { kind: 'provider', providerName: 'a', proxyName: 'N' }
  second.node.recordId = 'provider-b:N'
  second.node.source = { kind: 'provider', providerName: 'b', proxyName: 'N' }
  const { healthcheckNodeInProvider } = await import('tauri-plugin-mihomo-api')
  vi.mocked(healthcheckNodeInProvider)
    .mockResolvedValueOnce({ delay: 40 })
    .mockResolvedValueOnce({ delay: 125 })
  const firstListener = vi.fn()
  const secondListener = vi.fn()
  delayManager.setListener(first, 'provider-collision', firstListener)
  delayManager.setListener(second, 'provider-collision', secondListener)
  await delayManager.checkListDelay([first, second], 'provider-collision', 5000)
  await flush()
  expect(firstListener).toHaveBeenLastCalledWith(
    expect.objectContaining({ delay: 40 }),
  )
  expect(secondListener).toHaveBeenLastCalledWith(
    expect.objectContaining({ delay: 125 }),
  )
  delayManager.removeListener(first, 'provider-collision')
  delayManager.removeListener(second, 'provider-collision')
  expect(delayManager.getDelayFix(first, 'provider-collision')).toBe(40)
  expect(delayManager.getDelayFix(second, 'provider-collision')).toBe(125)
})

test.each(['core', 'provider'] as const)(
  'cached %s delays follow source identity after record IDs move',
  (kind) => {
    const original = node(`stable-${kind}`)
    const replacement = node(`replacement-${kind}`)
    if (original.kind !== 'node' || replacement.kind !== 'node')
      throw new Error('Expected nodes')
    const source = (proxyName: string) =>
      kind === 'core'
        ? { kind, proxyName }
        : { kind, providerName: 'subscription', proxyName }
    original.node.source = source(original.ref.name)
    replacement.node.source = source(replacement.ref.name)
    original.node.recordId = 'position:0'
    replacement.node.recordId = 'position:0'
    delayManager.setDelay(original, `reorder-${kind}`, 40)
    expect(delayManager.getDelayFix(replacement, `reorder-${kind}`)).toBe(-1)
    original.node.recordId = 'position:1'
    expect(delayManager.getDelayFix(original, `reorder-${kind}`)).toBe(40)
  },
)

test('unmeasured selectors show automatic history without replacing a manual URL result', () => {
  const member = node('selector-member')
  if (member.kind !== 'node') throw new Error('Expected node')
  member.node.history = [
    { time: new Date(Date.now() + 1000).toISOString(), delay: 126 },
  ]
  member.node.extra = {
    'http://localhost/automatic': { alive: true, history: member.node.history },
  }
  expect(delayManager.getDelayFix(member, 'selector')).toBe(126)
  delayManager.setDelay(member, 'selector', 50)
  expect(delayManager.getDelayFix(member, 'selector')).toBe(50)
})
