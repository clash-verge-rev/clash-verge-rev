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
  const cached = delayManager.setDelay(member.ref.name, 'tray-group', 50)
  member.node.history = [
    { time: new Date(cached.updatedAt + 1000).toISOString(), delay: 300 },
  ]

  expect(delayManager.getDelayFix(member, 'tray-group')).toBe(300)
  expect(
    delayManager.getDelayUpdate(
      member.ref.name,
      'tray-group',
      member.node.history,
    )?.delay,
  ).toBe(300)

  delayManager.setDelay(member.ref.name, 'tray-group', -2)
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
