import { expect, test } from 'vitest'

import { resolveActiveChainGroup } from './resolve-chain-group'

test('restores valid preferred group in rule mode', () => {
  const groups = [{ name: 'Group1' }, { name: 'Auto' }]
  const result = resolveActiveChainGroup('rule', 'Auto', groups)
  expect(result).toBe('Auto')
})

test('falls back to first group if preferred group is invalid or deleted', () => {
  const groups = [{ name: 'Group1' }, { name: 'Group2' }]
  const result = resolveActiveChainGroup('rule', 'DeletedGroup', groups)
  expect(result).toBe('Group1')
})

test('returns null in non-rule modes (e.g. global)', () => {
  const groups = [{ name: 'Group1' }, { name: 'Auto' }]
  const result = resolveActiveChainGroup('global', 'Auto', groups)
  expect(result).toBe(null)
})

test('returns null when available groups is empty', () => {
  const result = resolveActiveChainGroup('rule', 'Auto', [])
  expect(result).toBe(null)
})
