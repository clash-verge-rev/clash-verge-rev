import { expect, test } from 'vitest'

import { isProxyChainConnected } from './proxy-chain-model'

const chain = [{ name: 'entry' }, { name: 'exit' }]
const connected = [{ name: 'entry' }, { name: 'exit', 'dialer-proxy': 'entry' }]

test('selecting the exit does not connect a chain whose runtime links were lost', () => {
  expect(isProxyChainConnected(chain, 'exit', connected)).toBe(true)
  expect(isProxyChainConnected(chain, 'exit', chain)).toBe(false)
  expect(isProxyChainConnected(chain, 'exit', undefined)).toBe(false)
  expect(isProxyChainConnected(chain, 'entry', connected)).toBe(false)
  expect(isProxyChainConnected(chain, undefined, connected)).toBe(false)
})

test('editing the entry or an intermediate hop requires reconnecting the chain', () => {
  const edited = [{ name: 'other-entry' }, { name: 'exit' }]
  expect(isProxyChainConnected(edited, 'exit', connected)).toBe(false)

  const threeHops = [{ name: 'entry' }, { name: 'middle' }, { name: 'exit' }]
  const runtime = [
    { name: 'entry' },
    { name: 'middle', 'dialer-proxy': 'entry' },
    { name: 'exit', 'dialer-proxy': 'middle' },
  ]
  expect(isProxyChainConnected(threeHops, 'exit', runtime)).toBe(true)
  runtime[1]['dialer-proxy'] = undefined
  expect(isProxyChainConnected(threeHops, 'exit', runtime)).toBe(false)
  expect(isProxyChainConnected([{ name: 'exit' }], 'exit', connected)).toBe(
    false,
  )
})
