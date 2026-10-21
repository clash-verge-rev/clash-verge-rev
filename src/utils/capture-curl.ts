import type { CaptureBody, CaptureFlow } from '@/services/capture'

const HOP_BY_HOP_HEADERS = [
  'content-length',
  'transfer-encoding',
  'connection',
  'proxy-connection',
  'accept-encoding',
]

// Quote every captured value as shell data, including embedded single quotes.
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export const formatBody = (body: CaptureBody | null) => {
  if (!body) return ''
  if (body.encoding !== 'base64') return body.body
  try {
    return decodeBase64(body.body)
  } catch {
    return `[base64] ${body.body}`
  }
}

export const formatHeaders = (body: CaptureBody | null) =>
  (body?.headers ?? []).map(([name, value]) => `${name}: ${value}`).join('\n')

export const toCurl = (flow: CaptureFlow) => {
  const request = flow.request
  if (!request) throw new Error('curlNotRecorded')
  if (request.truncated) throw new Error('curlTruncated')

  const args = [
    'curl',
    '--request',
    quote(flow.method),
    '--url',
    quote(flow.url),
  ]

  for (const [name, value] of request.headers ?? []) {
    if (!HOP_BY_HOP_HEADERS.includes(name.toLowerCase())) {
      args.push('--header', quote(`${name}: ${value}`))
    }
  }

  if (!request.body) return args.join(' ')
  // Preserve binary bytes through Base64 instead of decoding them into shell text.
  return `printf '%s' ${quote(request.body)} | base64 --decode | ${args.join(' ')} --data-binary @-`
}
