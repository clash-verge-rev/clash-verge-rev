import { describe, expect, test } from 'vitest'

import parseTraffic from './parse-traffic'

describe('parseTraffic', () => {
  test('handles undefined and non-number inputs', () => {
    expect(parseTraffic(undefined)).toEqual(['NaN', ''])
    expect(parseTraffic()).toEqual(['NaN', ''])
    expect(parseTraffic(null as unknown as number)).toEqual(['NaN', ''])
    expect(parseTraffic('1024' as unknown as number)).toEqual(['NaN', ''])
  })

  test('handles NaN input preserving exact current behavior', () => {
    expect(parseTraffic(Number.NaN)).toEqual(['NaN', undefined])
  })

  test('handles zero', () => {
    expect(parseTraffic(0)).toEqual(['0.00', 'B'])
  })

  test('handles values below 1', () => {
    expect(parseTraffic(0.5)).toEqual(['0.500', 'B'])
    expect(parseTraffic(0.00123)).toEqual(['0.00123', 'B'])
    expect(parseTraffic(-5)).toEqual(['-5.00', 'B'])
  })

  test('handles 1023, 1024, and 1025 boundary values', () => {
    expect(parseTraffic(1023)).toEqual(['1023', 'B'])
    expect(parseTraffic(1024)).toEqual(['1.00', 'KB'])
    expect(parseTraffic(1025)).toEqual(['1.00', 'KB'])
  })

  test('handles values using the >= 1000 formatting branch', () => {
    expect(parseTraffic(1000)).toEqual(['1000', 'B'])
    expect(parseTraffic(1000 * 1024)).toEqual(['1000', 'KB'])
  })

  test('handles large values reaching higher units', () => {
    expect(parseTraffic(1.5 * 1024 * 1024)).toEqual(['1.50', 'MB'])
    expect(parseTraffic(1024 ** 3)).toEqual(['1.00', 'GB'])
    expect(parseTraffic(1024 ** 4)).toEqual(['1.00', 'TB'])
    expect(parseTraffic(1024 ** 8)).toEqual(['1.00', 'YB'])
  })

  test('caps unit exponent at the highest unit (YB) for extremely large numbers', () => {
    expect(parseTraffic(1024 ** 10)).toEqual(['1048576', 'YB'])
  })
})
