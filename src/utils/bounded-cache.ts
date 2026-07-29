/**
 * A Map-like container with a hard size limit and LRU eviction.
 *
 * Used for caches that can grow without bound if left unchecked (e.g. SWR
 * query keys that rotate with timestamps). The API is compatible with SWR's
 * `provider` contract: `get`, `set`, `delete`, `keys`.
 */
export class BoundedMap<K, V> implements Map<K, V> {
  private readonly map = new Map<K, V>()
  readonly [Symbol.toStringTag] = 'BoundedMap'

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new RangeError('maxSize must be a positive integer')
    }
  }

  get size() {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined && this.map.has(key)) {
      // Move to the end to mark as recently used.
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  getOrInsert(key: K, value: V): V {
    const existing = this.map.get(key)
    if (existing !== undefined || this.map.has(key)) {
      return existing as V
    }
    this.set(key, value)
    return value
  }

  getOrInsertComputed(key: K, compute: (key: K) => V): V {
    const existing = this.map.get(key)
    if (existing !== undefined || this.map.has(key)) {
      return existing as V
    }
    const value = compute(key)
    this.set(key, value)
    return value
  }

  set(key: K, value: V): this {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value as K | undefined
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey)
      }
    }
    this.map.set(key, value)
    return this
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.map.forEach((value, key) => {
      callbackfn.call(thisArg, value, key, this as unknown as Map<K, V>)
    })
  }

  keys() {
    return this.map.keys()
  }

  values() {
    return this.map.values()
  }

  entries() {
    return this.map.entries()
  }

  [Symbol.iterator]() {
    return this.map.entries()
  }
}
