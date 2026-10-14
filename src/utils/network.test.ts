import { describe, expect, test } from 'vitest'

import { isValidUrl } from './network'

describe('subscription URLs', () => {
  test.each(['http', 'https'])(
    'accepts long %s subscription URLs',
    (protocol) => {
      const prefix = `${protocol}://example.com/sub?token=`

      for (const length of [2084, 2085, 2525, 4096]) {
        const url = prefix + 'a'.repeat(length - prefix.length)

        expect(isValidUrl(url)).toBe(true)
      }

      expect(isValidUrl(prefix + 'a'.repeat(4097 - prefix.length))).toBe(false)
    },
  )

  test.each([
    'ftp://example.com/sub?token=',
    'example.com/sub?token=',
    'https://?token=',
    'https://example.com/sub?token=has space',
  ])('rejects malformed long subscription URLs: %s', (prefix) => {
    expect(isValidUrl(prefix + 'a'.repeat(2525))).toBe(false)
  })
})
