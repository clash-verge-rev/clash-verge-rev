import { expect, test } from 'vitest'

import { getDnsLeakStatus, getWebrtcLeakState } from './ip-leak-state'

test('does not declare DNS safe when resolver location is missing or incomplete', () => {
  expect(getDnsLeakStatus('US', [''])).toBe('unknown')
  expect(getDnsLeakStatus('US', ['US', ''])).toBe('unknown')
  expect(getDnsLeakStatus('US', [])).toBe('unknown')
  expect(getDnsLeakStatus('', ['US'])).toBe('unknown')
  expect(getDnsLeakStatus('US', ['  '])).toBe('unknown')
})

test('retains DNS region comparison when all locations are available', () => {
  expect(getDnsLeakStatus('US', ['US', 'us'])).toBe('safe')
  expect(getDnsLeakStatus('US', ['US', 'DE'])).toBe('mismatch')
})

test('does not declare a WebRTC leak without an egress baseline', () => {
  expect(getWebrtcLeakState(['203.0.113.8'], [])).toEqual({
    state: 'unknown',
    leaked: [],
  })
  expect(getWebrtcLeakState([], [])).toEqual({ state: 'unknown', leaked: [] })
})

test('compares WebRTC addresses only after a baseline is available', () => {
  expect(getWebrtcLeakState(['203.0.113.8'], ['203.0.113.8'])).toEqual({
    state: 'safe',
    leaked: [],
  })
  expect(getWebrtcLeakState(['203.0.113.9'], ['203.0.113.8'])).toEqual({
    state: 'leak',
    leaked: ['203.0.113.9'],
  })
  expect(getWebrtcLeakState([], ['203.0.113.8'])).toEqual({
    state: 'blocked',
    leaked: [],
  })
})
