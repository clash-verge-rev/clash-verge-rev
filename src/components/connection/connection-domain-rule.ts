import isIP from 'validator/es/lib/isIP'

import { normalizeHost } from '@/utils/network'

export type DomainRuleType = 'DOMAIN' | 'DOMAIN-SUFFIX'

export const normalizeDomain = (value: string) =>
  value.trim().replace(/\.$/u, '').toLowerCase()

export const isDomainName = (value: string) => {
  const domain = normalizeDomain(value)
  if (!domain || domain.length > 253) return false
  if (
    domain.includes('/') ||
    domain.includes(',') ||
    /[\r\n\s]/u.test(domain)
  ) {
    return false
  }
  const hostname = normalizeHost(domain)
  return !!hostname && !isIP(hostname)
}

export const buildDomainRule = (
  type: DomainRuleType,
  domain: string,
  policy: string,
) => {
  const normalizedDomain = normalizeDomain(domain)
  const normalizedPolicy = policy.trim()
  if (!isDomainName(normalizedDomain)) throw new Error('Invalid domain')
  if (
    !normalizedPolicy ||
    normalizedPolicy !== policy ||
    /[\r\n,]/u.test(policy)
  ) {
    throw new Error('Invalid proxy policy')
  }
  return `${type},${normalizedDomain},${policy}`
}

export const addDomainRule = (
  prepend: string[],
  append: string[],
  rule: string,
) => ({
  prepend: [rule, ...prepend.filter((item) => item !== rule)],
  append: append.filter((item) => item !== rule),
})
