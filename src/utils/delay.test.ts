import { describe, expect, test } from 'vitest'

import { classifyDelay, compareByDelay, DEFAULT_DELAY_TIMEOUT } from './delay'

describe('delay semantics', () => {
  test('classifies measurements and core sentinel values', () => {
    expect([
      classifyDelay(120),
      classifyDelay(-2),
      classifyDelay(-1),
      classifyDelay(0),
      classifyDelay(DEFAULT_DELAY_TIMEOUT),
      classifyDelay(1e5 + 1),
      classifyDelay(Number.NaN),
    ]).toEqual([
      'measured',
      'testing',
      'untested',
      'timeout',
      'timeout',
      'error',
      'untested',
    ])
    expect(classifyDelay(3000, 5000)).toBe('measured')
    expect(classifyDelay(3000, 2000)).toBe('timeout')
  })

  test('sorts measurements first and sentinel states by meaning', () => {
    const delays = [-1, 0, -2, 1e5 + 1, 300, 100]

    expect(delays.sort(compareByDelay)).toEqual([100, 300, 0, 1e5 + 1, -2, -1])
  })

  test('keeps the comparator symmetric', () => {
    const direction = (value: number) => Math.sign(value)
    const samples = [150, 0, -1, -2, 1e5 + 1]

    for (const a of samples) {
      for (const b of samples) {
        expect(
          direction(compareByDelay(a, b)) + direction(compareByDelay(b, a)),
        ).toBe(0)
      }
    }
  })
})
