import { expect, test } from 'vitest'

import { getIpRiskColor, getNetworkTypeColor } from './ip-assessment-display'

test.each([
  [0, 'success'],
  [29, 'success'],
  [30, 'warning'],
  [69, 'warning'],
  [70, 'error'],
  [100, 'error'],
  [null, 'default'],
] as const)('uses the risk color band for %s', (score, color) =>
  expect(getIpRiskColor(score)).toBe(color),
)

test('prioritizes residential and mobile networks while leaving unknown neutral', () => {
  expect(getNetworkTypeColor('residential')).toBe('success')
  expect(getNetworkTypeColor('isp')).toBe('success')
  expect(getNetworkTypeColor('hosting')).toBe('warning')
  expect(getNetworkTypeColor('unknown')).toBe('default')
})
