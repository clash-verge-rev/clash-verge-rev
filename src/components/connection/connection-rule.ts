import { dump, loadAll } from 'js-yaml'
import isFQDN from 'validator/es/lib/isFQDN'
import isIP from 'validator/es/lib/isIP'
import isIPRange from 'validator/es/lib/isIPRange'

export type ConnectionRuleKind = 'domain' | 'process' | 'source' | 'destination'

function getAddressRule(address: string | undefined, source: boolean) {
  const ip = address?.trim()
  if (!ip || !isIP(ip)) return undefined
  return getConnectionIPRule(`${ip}/${isIP(ip, 4) ? 32 : 128}`, source)
}

export function getConnectionIPRule(value: string, source: boolean) {
  const cidr = value.trim()
  if (cidr.includes('%') || !isIPRange(cidr)) return undefined
  const ipv4 = isIP(cidr.split('/')[0], 4)
  return {
    type: source ? 'SRC-IP-CIDR' : ipv4 ? 'IP-CIDR' : 'IP-CIDR6',
    value: cidr,
  }
}

export function getConnectionRuleTargets(
  metadata: Pick<
    IConnectionsItem['metadata'],
    | 'host'
    | 'process'
    | 'processPath'
    | 'sourceIP'
    | 'destinationIP'
    | 'remoteDestination'
  >,
) {
  const host = metadata.host?.trim() ?? ''
  const path = metadata.processPath
  const name = metadata.process
  const domain =
    host && !isIP(host) && isFQDN(host, { require_tld: false })
      ? { type: 'DOMAIN', value: host }
      : undefined
  const process = path?.trim()
    ? { type: 'PROCESS-PATH', value: path }
    : name?.trim()
      ? { type: 'PROCESS-NAME', value: name }
      : undefined
  const source = getAddressRule(metadata.sourceIP, true)
  const destination =
    getAddressRule(metadata.destinationIP, false) ??
    getAddressRule(metadata.remoteDestination, false)
  return { domain, process, source, destination }
}

export function isConnectionRuleDomain(value: string, host: string) {
  const domain = value.trim()
  if (!domain || isIP(domain) || !isFQDN(domain, { require_tld: false }))
    return false
  const normalized = domain.toLowerCase()
  const current = host.toLowerCase()
  return (
    normalized === current ||
    (domain.split('.').length >= 2 && current.endsWith(`.${normalized}`))
  )
}

export async function getConnectionRootDomain(host: string) {
  const { parse } = await import('tldts')
  const { domain, isIcann, isPrivate } = parse(host, {
    allowPrivateDomains: true,
  })
  return domain && (isIcann || isPrivate) ? domain : undefined
}

function parseRuleExtension(content: string) {
  const documents = loadAll(content)
  if (documents.length > 1) {
    throw new Error('The rule extension must contain a single YAML document.')
  }
  const parsed = documents[0]
  if (
    parsed !== undefined &&
    parsed !== null &&
    (typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype)
  ) {
    throw new Error('The rule extension must be a YAML mapping.')
  }
  const config = (parsed ?? {}) as Record<string, unknown>
  for (const key of ['prepend', 'append', 'delete']) {
    const sequence = config[key]
    if (
      sequence != null &&
      (!Array.isArray(sequence) ||
        sequence.some((item) => typeof item !== 'string'))
    ) {
      throw new Error('The rule extension contains an invalid rule list.')
    }
  }
  return config
}

interface RuleCondition {
  type: string
  value: string
}

function matchesConnectionRule(raw: string, target: RuleCondition) {
  const parts = raw.split(',').map((part) => part.trim())
  const hasNoResolve =
    (target.type === 'IP-CIDR' || target.type === 'IP-CIDR6') &&
    parts.length === 4 &&
    parts[3] === 'no-resolve'
  if (parts.length !== 3 && !hasNoResolve) return false
  if (target.type === 'DOMAIN' || target.type === 'DOMAIN-SUFFIX') {
    return (
      parts[0] === target.type &&
      parts[1].toLowerCase() === target.value.toLowerCase()
    )
  }
  return parts[0] === target.type && parts[1] === target.value
}

export function getConnectionRules(content: string): string[] {
  const config = parseRuleExtension(content)
  return [
    ...((config.prepend ?? []) as string[]),
    ...((config.append ?? []) as string[]),
  ]
}

export function findConnectionRule(rules: string[], target: RuleCondition) {
  for (const raw of rules) {
    if (matchesConnectionRule(raw, target)) {
      const [type, , policy] = raw.split(',').map((part) => part.trim())
      return { type, policy }
    }
  }
  return undefined
}

export function saveConnectionRule(
  content: string,
  target: RuleCondition,
  policy: string,
): string {
  const config = parseRuleExtension(content)
  const rule = `${target.type},${target.value},${policy}`
  let replaced = false
  for (const key of ['prepend', 'append']) {
    if (!Array.isArray(config[key])) continue
    config[key] = (config[key] as string[]).flatMap((raw) => {
      if (!matchesConnectionRule(raw, target)) return [raw]
      if (replaced) return []
      replaced = true
      return [raw.split(',').length === 4 ? `${rule},no-resolve` : rule]
    })
  }
  if (!replaced) {
    config.prepend = [rule, ...((config.prepend ?? []) as string[])]
  }
  return dump(config, { forceQuotes: true })
}
