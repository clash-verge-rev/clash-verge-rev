import type { CaptureBody } from '@/services/capture'

import { formatBody } from './capture-curl'

export interface KeyValue {
  name: string
  value: string
}

export const decodeBody = (body: CaptureBody | null) => formatBody(body)

export const headerPairs = (body: CaptureBody | null): KeyValue[] =>
  (body?.headers ?? []).map(([name, value]) => ({ name, value }))

export const queryPairs = (url: string): KeyValue[] => {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({
      name,
      value,
    }))
  } catch {
    return []
  }
}

const splitPair = (text: string): KeyValue => {
  const index = text.indexOf('=')
  if (index < 0) return { name: text.trim(), value: '' }
  return {
    name: text.slice(0, index).trim(),
    value: text.slice(index + 1).trim(),
  }
}

/** Request cookies come from the Cookie header; response cookies from Set-Cookie. */
export const cookiePairs = (
  body: CaptureBody | null,
  request: boolean,
): KeyValue[] => {
  const headers = body?.headers ?? []
  if (request) {
    const cookie = headers.find(
      ([name]) => name.toLowerCase() === 'cookie',
    )?.[1]
    return cookie
      ? cookie
          .split(';')
          .map(splitPair)
          .filter(({ name }) => name)
      : []
  }
  return headers
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, value]) => splitPair(value.split(';')[0]))
}

export const prettyJson = (text: string): string | null => {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

/** Bucket a Content-Type header into the same kinds the capture API filters by. */
export const contentTypeKind = (contentType: string | undefined): string => {
  const value = (contentType ?? '').toLowerCase()
  if (!value) return ''
  if (value.includes('html')) return 'html'
  if (value.includes('json')) return 'json'
  if (value.startsWith('image/')) return 'image'
  if (value.includes('javascript') || value.includes('ecmascript'))
    return 'script'
  if (value.includes('css')) return 'css'
  if (value.includes('font')) return 'font'
  return 'other'
}
