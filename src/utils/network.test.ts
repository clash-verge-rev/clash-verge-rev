import { describe, expect, test } from 'vitest'

import { isValidUrl } from './network'

describe('isValidUrl', () => {
  test('accepts a typical http URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
  })

  test('accepts a typical https URL with path and query', () => {
    expect(isValidUrl('https://example.com/sub?token=abc123')).toBe(true)
  })

  test('accepts a long https URL exceeding 2084 characters', () => {
    const longUrl = `https://example.com/sub?token=${'a'.repeat(2500)}`
    expect(longUrl.length).toBeGreaterThan(2084)
    expect(isValidUrl(longUrl)).toBe(true)
  })

  test('rejects a URL without protocol', () => {
    expect(isValidUrl('example.com')).toBe(false)
  })

  test('rejects a URL with ftp protocol', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false)
  })

  test('rejects an empty string', () => {
    expect(isValidUrl('')).toBe(false)
  })

  test('rejects a URL without host', () => {
    expect(isValidUrl('http://')).toBe(false)
  })
})
