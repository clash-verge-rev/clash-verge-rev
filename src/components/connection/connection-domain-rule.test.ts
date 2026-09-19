import { expect, test } from 'vitest'

import {
  addDomainRule,
  buildDomainRule,
  isDomainName,
} from './connection-domain-rule'

test('validates domain hosts and rejects IP addresses and rule delimiters', () => {
  expect(isDomainName('Example.COM')).toBe(true)
  expect(isDomainName('localhost')).toBe(true)
  expect(isDomainName('127.0.0.1')).toBe(false)
  expect(isDomainName('https://example.com/path')).toBe(false)
  expect(isDomainName('example.com,Proxy')).toBe(false)
})

test('builds a normalized rule while preserving the selected policy name', () => {
  expect(buildDomainRule('DOMAIN-SUFFIX', ' Example.COM. ', 'Group A')).toBe(
    'DOMAIN-SUFFIX,example.com,Group A',
  )
  expect(() => buildDomainRule('DOMAIN', 'example.com', ' Group A ')).toThrow()
})

test('moves an exact duplicate to prepend and removes it from append', () => {
  expect(
    addDomainRule(
      ['DOMAIN,example.com,DIRECT', 'DOMAIN,other.com,DIRECT'],
      ['DOMAIN,example.com,DIRECT', 'DOMAIN,example.com,REJECT'],
      'DOMAIN,example.com,DIRECT',
    ),
  ).toEqual({
    prepend: ['DOMAIN,example.com,DIRECT', 'DOMAIN,other.com,DIRECT'],
    append: ['DOMAIN,example.com,REJECT'],
  })
})
