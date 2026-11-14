import { dump, load } from 'js-yaml'
import isFQDN from 'validator/es/lib/isFQDN'
import isIP from 'validator/es/lib/isIP'

export function getConnectionRuleTargets(
  metadata: Pick<
    IConnectionsItem['metadata'],
    'host' | 'process' | 'processPath'
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
  return { domain, process }
}

function parseRuleExtension(content: string) {
  const parsed: unknown = load(content)
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
  if (parts.length !== 3) return false
  if (target.type === 'DOMAIN' || target.type === 'DOMAIN-SUFFIX') {
    return (
      parts[0] === target.type &&
      parts[1].toLowerCase() === target.value.toLowerCase()
    )
  }
  return parts[0] === target.type && parts[1] === target.value
}

export function findConnectionRule(content: string, target: RuleCondition) {
  const config = parseRuleExtension(content)
  for (const key of ['prepend', 'append']) {
    for (const raw of (config[key] ?? []) as string[]) {
      if (matchesConnectionRule(raw, target)) {
        const [type, , policy] = raw.split(',').map((part) => part.trim())
        return { type, policy }
      }
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
      return [rule]
    })
  }
  if (!replaced) {
    config.prepend = [rule, ...((config.prepend ?? []) as string[])]
  }
  return dump(config, { forceQuotes: true })
}
