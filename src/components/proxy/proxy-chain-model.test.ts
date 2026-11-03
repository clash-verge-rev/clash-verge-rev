import { expect, test } from 'vitest'

import { isProxyChainConnected } from './proxy-chain-model'

const chain = [{ name: 'entry' }, { name: 'exit' }]
const connected = [{ name: 'entry' }, { name: 'exit', 'dialer-proxy': 'entry' }]

test('selecting the exit without applying the chain is not connected', () => {
  expect(isProxyChainConnected(chain, 'exit', chain)).toBe(false)
  expect(isProxyChainConnected(chain, 'exit', undefined)).toBe(false)
  expect(isProxyChainConnected([{ name: 'exit' }], 'exit', connected)).toBe(
    false,
  )
})

test('losing runtime links after regeneration requires reconnecting', () => {
  expect(isProxyChainConnected(chain, 'exit', connected)).toBe(true)
  const regenerated = connected.map(({ name }) => ({ name }))
  expect(isProxyChainConnected(chain, 'exit', regenerated)).toBe(false)
})

test('changing the entry or an intermediate hop with the same exit requires reconnecting', () => {
  expect(
    isProxyChainConnected(
      [{ name: 'other-entry' }, { name: 'exit' }],
      'exit',
      connected,
    ),
  ).toBe(false)

  const threeHops = [{ name: 'entry' }, { name: 'middle' }, { name: 'exit' }]
  const runtime = [
    { name: 'entry' },
    { name: 'middle', 'dialer-proxy': 'entry' },
    { name: 'exit', 'dialer-proxy': 'middle' },
  ]
  expect(isProxyChainConnected(threeHops, 'exit', runtime)).toBe(true)
  expect(
    isProxyChainConnected(
      [{ name: 'entry' }, { name: 'other-middle' }, { name: 'exit' }],
      'exit',
      runtime,
    ),
  ).toBe(false)
  runtime[1]['dialer-proxy'] = undefined
  expect(isProxyChainConnected(threeHops, 'exit', runtime)).toBe(false)
})

test('an applied chain is connected only while its exit is selected', () => {
  expect(isProxyChainConnected(chain, 'exit', connected)).toBe(true)
  expect(isProxyChainConnected(chain, 'entry', connected)).toBe(false)
  expect(isProxyChainConnected(chain, null, connected)).toBe(false)
  expect(isProxyChainConnected(chain, undefined, connected)).toBe(false)
})
