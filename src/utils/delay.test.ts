import { describe, expect, test } from 'vitest'

import { classifyDelay, compareByDelay, DEFAULT_DELAY_TIMEOUT } from './delay'

describe('classifyDelay', () => {
  test('an ordinary latency is a measurement', () => {
    expect(classifyDelay(120)).toBe('measured')
    expect(classifyDelay(DEFAULT_DELAY_TIMEOUT - 1)).toBe('measured')
  })

  test('the core reports an in-flight test as -2', () => {
    expect(classifyDelay(-2)).toBe('testing')
  })

  test('any other negative means we have never measured it', () => {
    expect(classifyDelay(-1)).toBe('untested')
    expect(classifyDelay(-99)).toBe('untested')
  })

  test('zero and anything past the timeout are timeouts, not fast results', () => {
    // Zero is the trap: sorted as a number it would come first.
    expect(classifyDelay(0)).toBe('timeout')
    expect(classifyDelay(DEFAULT_DELAY_TIMEOUT)).toBe('timeout')
  })

  test('an implausible value is an error rather than a very slow node', () => {
    expect(classifyDelay(1e5 + 1)).toBe('error')
  })

  test('a non-number is treated as never measured', () => {
    expect(classifyDelay(Number.NaN)).toBe('untested')
    expect(classifyDelay(Number.POSITIVE_INFINITY)).toBe('untested')
  })

  test('the timeout is configurable per test URL', () => {
    expect(classifyDelay(3000, 2000)).toBe('timeout')
    expect(classifyDelay(3000, 5000)).toBe('measured')
  })
})

describe('compareByDelay', () => {
  const sorted = (delays: number[]) =>
    [...delays].sort((a, b) => compareByDelay(a, b))

  test('faster measurements come first', () => {
    expect(sorted([300, 100, 200])).toEqual([100, 200, 300])
  })

  test('a timeout never sorts ahead of a measurement, however it is encoded', () => {
    expect(sorted([0, 150])).toEqual([150, 0])
    expect(sorted([DEFAULT_DELAY_TIMEOUT, 150])).toEqual([
      150,
      DEFAULT_DELAY_TIMEOUT,
    ])
  })

  test('untested nodes sink below everything measurable', () => {
    expect(sorted([-1, 0, 1e5 + 1, 150])).toEqual([150, 0, 1e5 + 1, -1])
  })

  test('a node being tested outranks one never tested', () => {
    expect(sorted([-1, -2])).toEqual([-2, -1])
  })

  test('non-numbers sink rather than scrambling the order around them', () => {
    // This is the case the two previous copies disagreed on: one sorted a non-number
    // among the timeouts, the other after the sentinels.
    expect(compareByDelay(Number.NaN, 150)).toBeGreaterThan(0)
    expect(compareByDelay(Number.NaN, -1)).toBe(0)
  })

  test('the order is total, so sorting is stable whichever way a pair is compared', () => {
    const direction = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0)
    const samples = [150, 0, -1, -2, 1e5 + 1, 20]

    for (const a of samples) {
      for (const b of samples) {
        // Summing avoids comparing against -0, which Object.is treats as distinct from 0.
        expect(
          direction(compareByDelay(a, b)) + direction(compareByDelay(b, a)),
        ).toBe(0)
      }
    }
  })
})
