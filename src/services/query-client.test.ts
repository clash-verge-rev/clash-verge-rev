import { beforeEach, describe, expect, it } from 'vitest'

import {
  cleanupSubscriptionKeys,
  getCacheData,
  registerSubscriptionKey,
  removeCacheData,
  setCacheData,
} from './query-client'

describe('query-client subscription cache cleanup', () => {
  beforeEach(() => {
    // Ensure each test starts with a clean prefix registry.
    cleanupSubscriptionKeys('getClashLog')
    cleanupSubscriptionKeys('getClashTraffic')
    cleanupSubscriptionKeys('getClashMemory')
  })

  it('registers subscription keys and cleans up old ones by prefix', async () => {
    const oldKey = ['$sub$getClashLog-1000']
    const newKey = ['$sub$getClashLog-2000']

    setCacheData(oldKey, ['old log'])
    setCacheData(newKey, ['new log'])
    registerSubscriptionKey('getClashLog', oldKey)
    registerSubscriptionKey('getClashLog', newKey)

    expect(getCacheData(oldKey)).toEqual(['old log'])
    expect(getCacheData(newKey)).toEqual(['new log'])

    await cleanupSubscriptionKeys('getClashLog', newKey)

    expect(getCacheData(oldKey)).toBeUndefined()
    expect(getCacheData(newKey)).toEqual(['new log'])
  })

  it('cleans all keys for a prefix when no current key is provided', async () => {
    const key1 = ['$sub$getClashLog-1000']
    const key2 = ['$sub$getClashLog-2000']

    setCacheData(key1, ['log1'])
    setCacheData(key2, ['log2'])
    registerSubscriptionKey('getClashLog', key1)
    registerSubscriptionKey('getClashLog', key2)

    await cleanupSubscriptionKeys('getClashLog')

    expect(getCacheData(key1)).toBeUndefined()
    expect(getCacheData(key2)).toBeUndefined()
  })

  it('does not touch keys with a different prefix', async () => {
    const logKey = ['$sub$getClashLog-1000']
    const trafficKey = ['$sub$getClashTraffic-1000']

    setCacheData(logKey, ['log'])
    setCacheData(trafficKey, ['traffic'])
    registerSubscriptionKey('getClashLog', logKey)
    registerSubscriptionKey('getClashTraffic', trafficKey)

    await cleanupSubscriptionKeys('getClashLog')

    expect(getCacheData(logKey)).toBeUndefined()
    expect(getCacheData(trafficKey)).toEqual(['traffic'])
  })

  it('removeCacheData deletes the key and returns undefined', () => {
    const key = ['test-key']
    setCacheData(key, 'value')
    expect(getCacheData(key)).toBe('value')

    removeCacheData(key)

    expect(getCacheData(key)).toBeUndefined()
  })
})
