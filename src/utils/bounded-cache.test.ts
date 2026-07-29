import { describe, expect, test } from 'vitest'

import { BoundedMap } from './bounded-cache'

describe('BoundedMap', () => {
  test('stores and retrieves values', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    map.set('b', 2)

    expect(map.get('a')).toBe(1)
    expect(map.get('b')).toBe(2)
    expect(map.has('a')).toBe(true)
    expect(map.has('missing')).toBe(false)
  })

  test('evicts the oldest entry when the size limit is exceeded', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    map.set('b', 2)
    map.set('c', 3)
    map.set('d', 4)

    expect(map.has('a')).toBe(false)
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(3)
    expect(map.get('d')).toBe(4)
  })

  test('accessing a key refreshes it as recently used', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    map.set('b', 2)
    map.set('c', 3)

    // Access 'a' so it becomes the most recently used.
    map.get('a')
    map.set('d', 4)

    expect(map.get('a')).toBe(1)
    expect(map.has('b')).toBe(false)
  })

  test('updating an existing key refreshes its position without growing', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    map.set('b', 2)
    map.set('c', 3)

    map.set('a', 10)
    map.set('d', 4)

    expect(map.get('a')).toBe(10)
    expect(map.has('b')).toBe(false)
  })

  test('delete removes an entry', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    expect(map.delete('a')).toBe(true)
    expect(map.delete('a')).toBe(false)
    expect(map.has('a')).toBe(false)
  })

  test('clear removes all entries', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    map.set('b', 2)
    map.clear()

    expect(map.size).toBe(0)
    expect(map.has('a')).toBe(false)
  })

  test('exposes keys in insertion/recency order', () => {
    const map = new BoundedMap<string, number>(3)
    map.set('a', 1)
    map.set('b', 2)
    map.get('a')

    expect(Array.from(map.keys())).toEqual(['b', 'a'])
  })

  test('throws for invalid maxSize', () => {
    expect(() => new BoundedMap(0)).toThrow(RangeError)
    expect(() => new BoundedMap(-1)).toThrow(RangeError)
    expect(() => new BoundedMap(1.5)).toThrow(RangeError)
  })
})
