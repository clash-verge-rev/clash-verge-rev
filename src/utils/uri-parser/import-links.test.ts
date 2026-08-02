import * as yaml from 'js-yaml'
import { describe, expect, test } from 'vitest'

import { buildProxiesProfileYaml, parseShareLinks } from './import-links'

const SS = `ss://${btoa('aes-256-gcm:pass')}@1.2.3.4:8388#US`
const TROJAN = 'trojan://pw@1.2.3.4:443?sni=example.com#JP'
const VLESS = 'vless://u@1.2.3.4:443?type=ws&security=tls&host=e.com#HK'

describe('parseShareLinks', () => {
  test('parses several links of different protocols', () => {
    const result = parseShareLinks(`${SS}\n${TROJAN}\n${VLESS}`)
    expect(result.imported).toBe(3)
    expect(result.failed).toEqual([])
    expect(result.proxies.map((p) => p.type)).toEqual(['ss', 'trojan', 'vless'])
  })

  test('collects unparseable lines instead of dropping them silently', () => {
    const result = parseShareLinks(
      `${SS}\nnot-a-link\nhttp-garbage://\n${TROJAN}`,
    )
    expect(result.imported).toBe(2)
    expect(result.failed).toEqual(['not-a-link', 'http-garbage://'])
  })

  test('ignores blank lines and comments', () => {
    const result = parseShareLinks(
      `# my nodes\n${SS}\n\n  \n// keep this one too\n${TROJAN}`,
    )
    expect(result.imported).toBe(2)
    expect(result.failed).toEqual([])
  })

  test('decodes a base64 subscription blob', () => {
    const blob = btoa(`${SS}\n${TROJAN}`)
    const result = parseShareLinks(blob)
    expect(result.imported).toBe(2)
    expect(result.proxies.map((p) => p.type)).toEqual(['ss', 'trojan'])
  })

  test('renames duplicate node names so every proxy is unique', () => {
    const dup = 'trojan://pw@1.2.3.4:443#Same'
    const result = parseShareLinks(`${dup}\n${dup}\n${dup}`)
    expect(result.imported).toBe(3)
    expect(result.renamed).toBe(2)
    const names = result.proxies.map((p) => p.name)
    expect(new Set(names).size).toBe(3)
    expect(names).toEqual(['Same', 'Same 2', 'Same 3'])
  })

  test('returns nothing for empty input', () => {
    expect(parseShareLinks('   \n  ').imported).toBe(0)
  })
})

describe('buildProxiesProfileYaml', () => {
  test('produces a valid, usable clash profile', () => {
    const { proxies } = parseShareLinks(`${SS}\n${TROJAN}`)
    const doc = yaml.load(buildProxiesProfileYaml(proxies)) as {
      proxies: IProxyConfig[]
      'proxy-groups': { name: string; type: string; proxies: string[] }[]
      rules: string[]
    }

    // The proxies survive the round-trip intact.
    expect(doc.proxies).toHaveLength(2)
    expect(doc.proxies.map((p) => p.name)).toEqual(['US', 'JP'])

    // A select group references every node plus DIRECT, and a rule routes to it.
    const group = doc['proxy-groups'][0]
    expect(group).toMatchObject({ name: 'PROXY', type: 'select' })
    expect(group.proxies).toEqual(['US', 'JP', 'DIRECT'])
    expect(doc.rules).toEqual(['MATCH,PROXY'])
  })

  test('every group member is a real proxy name (no dangling references)', () => {
    const { proxies } = parseShareLinks(`${SS}\n${TROJAN}\n${VLESS}`)
    const doc = yaml.load(buildProxiesProfileYaml(proxies)) as {
      proxies: IProxyConfig[]
      'proxy-groups': { proxies: string[] }[]
    }
    const proxyNames = new Set(doc.proxies.map((p) => p.name))
    for (const ref of doc['proxy-groups'][0].proxies) {
      expect(ref === 'DIRECT' || proxyNames.has(ref)).toBe(true)
    }
  })
})
