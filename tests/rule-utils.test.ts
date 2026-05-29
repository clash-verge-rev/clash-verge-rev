import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildLogicalRuleValue,
  buildRuleRaw,
  getRawRuleIdentitySignature,
  getRulePresetDialogState,
  normalizeLogicalRuleValue,
  parseLogicalRuleItems,
  runtimeRuleToRaw,
  sanitizeManualRules,
} from '../src/utils/rule-utils.ts'

test('builds canonical logical rule values from structured sub-rules', () => {
  assert.equal(
    buildLogicalRuleValue([
      { id: 'a', type: 'DOMAIN', value: 'example.com', noResolve: false },
      { id: 'b', type: 'NETWORK', value: 'udp', noResolve: false },
      { id: 'c', type: 'IP-CIDR', value: '1.1.1.1/32', noResolve: true },
    ]),
    '((DOMAIN,example.com),(NETWORK,UDP),(IP-CIDR,1.1.1.1/32,no-resolve))',
  )
})

test('normalizes runtime logical expression syntax into stored logical values', () => {
  assert.equal(
    normalizeLogicalRuleValue(
      'AND',
      '((Network,udp) && (ProcessPath,/Applications/Foo.app/Contents/MacOS/foo))',
    ),
    '((NETWORK,UDP),(PROCESS-PATH,/Applications/Foo.app/Contents/MacOS/foo))',
  )

  assert.equal(
    normalizeLogicalRuleValue('NOT', '!(Domain,example.com)'),
    '((DOMAIN,example.com))',
  )
})

test('parses editor logical payloads with the selected outer operator', () => {
  const andItems = parseLogicalRuleItems(
    'AND',
    '((Network,udp) && (ProcessPath,/tmp/app))',
  )

  assert.equal(andItems.length, 2)
  assert.equal(andItems[0].type, 'NETWORK')
  assert.equal(andItems[1].type, 'PROCESS-PATH')
  assert.equal(
    buildLogicalRuleValue(andItems),
    '((NETWORK,UDP),(PROCESS-PATH,/tmp/app))',
  )

  const notItems = parseLogicalRuleItems('NOT', '!(Domain,example.com)')

  assert.equal(notItems.length, 1)
  assert.equal(notItems[0].type, 'DOMAIN')
  assert.equal(buildLogicalRuleValue(notItems), '((DOMAIN,example.com))')
})

test('parses and rebuilds nested logical sub-rules without requiring raw input', () => {
  const raw =
    '((OR,((DOMAIN-KEYWORD,google),(DOMAIN-SUFFIX,example.com))),(NETWORK,udp))'
  const items = parseLogicalRuleItems(raw)

  assert.equal(items.length, 2)
  assert.equal(items[0].type, 'OR')
  assert.equal(
    items[0].value,
    '((DOMAIN-KEYWORD,google),(DOMAIN-SUFFIX,example.com))',
  )
  assert.equal(buildLogicalRuleValue(items), raw.replace('udp', 'UDP'))
})

test('keeps no-resolve only on supported logical sub-rule types', () => {
  const items = parseLogicalRuleItems(
    '((IP-CIDR,1.1.1.1/32,no-resolve),(DOMAIN,example.com,no-resolve))',
  )

  assert.equal(items[0].noResolve, true)
  assert.equal(items[1].noResolve, false)
  assert.equal(
    buildLogicalRuleValue(items),
    '((IP-CIDR,1.1.1.1/32,no-resolve),(DOMAIN,example.com))',
  )
})

test('deduplicates manual rules across canonical and runtime logical forms', () => {
  const sanitized = sanitizeManualRules({
    prepend: ['AND,((NETWORK,UDP),(PROCESS-PATH,/tmp/app)),DIRECT'],
    append: ['AND,((Network,udp) && (ProcessPath,/tmp/app)),DIRECT'],
    delete: [],
  })

  assert.deepEqual(sanitized, {
    prepend: ['AND,((NETWORK,UDP),(PROCESS-PATH,/tmp/app)),DIRECT'],
    append: [],
    delete: [],
  })
  assert.equal(
    getRawRuleIdentitySignature(
      'AND,((Network,udp) && (ProcessPath,/tmp/app)),DIRECT',
    ),
    getRawRuleIdentitySignature(
      'AND,((NETWORK,UDP),(PROCESS-PATH,/tmp/app)),DIRECT',
    ),
  )
})

test('normalizes routed rule presets before opening the editor', () => {
  assert.deepEqual(
    getRulePresetDialogState(
      {
        type: 'ProcessPath',
        value: '/Applications/Foo.app/Contents/MacOS/foo',
      },
      'DIRECT',
    ),
    {
      kind: 'standard',
      form: {
        type: 'PROCESS-PATH',
        value: '/Applications/Foo.app/Contents/MacOS/foo',
        policy: 'DIRECT',
        noResolve: false,
      },
    },
  )
})

test('builds rule rows from editor forms and runtime rules consistently', () => {
  assert.equal(
    buildRuleRaw({
      type: 'NETWORK',
      value: 'udp',
      policy: 'DIRECT',
      noResolve: true,
    }),
    'NETWORK,UDP,DIRECT',
  )
  assert.equal(
    runtimeRuleToRaw({
      type: 'ProcessPath',
      payload: '/Applications/Foo.app/Contents/MacOS/foo',
      proxy: 'DIRECT',
    }),
    'PROCESS-PATH,/Applications/Foo.app/Contents/MacOS/foo,DIRECT',
  )
})
