import dayjs from 'dayjs'

import {
  appendTestLogs as cmdAppendTestLogs,
  getTestLogs as cmdGetTestLogs,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

export type TestKind = 'delay' | 'speed'
export type TestStatus =
  | 'success'
  | 'timeout'
  | 'error'
  | 'retry'
  | 'cancelled'
  | 'early_eof'

export type TestErrorKind =
  | 'early_eof'
  | 'http_403'
  | 'http_5xx'
  | 'timeout'
  | 'connection_reset'
  | 'connection_aborted'
  | 'tls_handshake'
  | 'dns'
  | 'proxy_connect'
  | 'no_data'
  | 'network'
  | 'unknown'

export interface TestLogInput {
  kind: TestKind
  status: TestStatus
  group: string
  name?: string
  delay?: number
  speed?: number
  ttfb?: number
  target?: string
  region?: string
  priority?: number
  elapsed?: number
  measuredBytes?: number
  warmup?: number
  retry?: number
  errorKind?: TestErrorKind
  message?: string
}

type TestLogListener = (logs: ILogItem[]) => void

const MAX_TEST_LOGS = 1000
const MAX_PENDING_LOGS = 200
const FLUSH_DELAY = 250
const MAX_FIELD_LENGTH = 180
const MAX_PAYLOAD_LENGTH = 1800

let logs: ILogItem[] = []
let pending: ILogItem[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const subscribers = new Set<TestLogListener>()

export function appendTestLog(input: TestLogInput) {
  const entry = toLogItem(input)
  logs = clampLogs(logs.concat(entry))
  pending.push(entry)
  if (pending.length > MAX_PENDING_LOGS) {
    pending = pending.slice(-MAX_PENDING_LOGS)
  }
  subscribers.forEach((subscriber) => subscriber([entry]))
  scheduleFlush()
}

export function subscribeTestLogs(listener: TestLogListener) {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}

export function getTestLogSnapshot() {
  return logs
}

export function clearTestLogSnapshot() {
  logs = []
}

export async function loadPersistedTestLogs() {
  const persisted = await cmdGetTestLogs()
  logs = clampLogs(mergeLogs(logs, persisted))
  return logs
}

export function showTestErrorSummary(input: {
  kind: TestKind
  total: number
  failed: number
  retried?: number
  message?: string
}) {
  if (input.failed <= 0 || input.total <= 0) return

  const subject = input.kind === 'speed' ? '下载测速' : '延迟测试'
  const retry = input.retried ? `，已低并发重试 ${input.retried} 个` : ''
  const detail = input.message ? `：${limitText(redact(input.message), 220)}` : ''
  showNotice.error(
    `${subject}失败 ${input.failed}/${input.total}${retry}${detail}`,
    10000,
  )
}

export function getTestErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function getTestFailureStatus(message: string): TestStatus {
  const kind = classifyTestError(message)
  if (kind === 'early_eof') return 'early_eof'
  return kind === 'timeout' ? 'timeout' : 'error'
}

export function sanitizeTestMessage(value: string) {
  return limitText(redact(value), MAX_FIELD_LENGTH)
}

export function classifyTestError(message: string): TestErrorKind {
  const text = message.toLowerCase()
  if (/early.?eof|文件过小|提前/.test(text)) return 'early_eof'
  if (/403|forbidden/.test(text)) return 'http_403'
  if (/http status: 5\d\d|5\d\d/.test(text)) return 'http_5xx'
  if (/isolated mihomo proxy port|isolated.*proxy port/.test(text)) {
    return 'proxy_connect'
  }
  if (/timed out|timeout|operation timed out|超时/.test(text)) return 'timeout'
  if (/10054|connection reset|forcibly closed|强迫关闭/.test(text)) {
    return 'connection_reset'
  }
  if (/10053|software.*abort|中止了一个已建立的连接/.test(text)) {
    return 'connection_aborted'
  }
  if (/tls handshake|handshake eof|certificate|ssl/.test(text)) {
    return 'tls_handshake'
  }
  if (/dns|resolve|lookup|name or service|no such host/.test(text)) return 'dns'
  if (/proxy|connect.*127\.0\.0\.1|connect.*failed/.test(text)) {
    return 'proxy_connect'
  }
  if (/no measured data|no data|stalled before enough data/.test(text)) {
    return 'no_data'
  }
  if (/network|connection|connect|socket|os error/.test(text)) return 'network'
  return 'unknown'
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPendingLogs()
  }, FLUSH_DELAY)
}

async function flushPendingLogs() {
  if (!pending.length) return

  const batch = pending.splice(0, pending.length)
  try {
    await cmdAppendTestLogs(
      batch.map((log) => ({
        time: log.time,
        type: 'test',
        payload: log.payload,
      })),
    )
  } catch (error) {
    console.warn('[TestLog] Failed to persist TEST logs', error)
  }
}

function toLogItem(input: TestLogInput): ILogItem {
  return {
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    type: 'test',
    payload: buildPayload(input),
  }
}

function buildPayload(input: TestLogInput) {
  const fields = [
    field('type', input.kind),
    field('status', input.status),
    field('group', input.group),
    input.name ? field('server', input.name) : '',
    input.target ? field('target', input.target) : '',
    input.region ? field('region', input.region) : '',
    typeof input.priority === 'number' ? field('priority', input.priority) : '',
    typeof input.retry === 'number' && input.retry > 0
      ? field('retry', input.retry)
      : '',
    input.errorKind ? field('error_kind', input.errorKind) : '',
    typeof input.elapsed === 'number'
      ? field('elapsed', `${input.elapsed}ms`)
      : '',
    typeof input.delay === 'number' ? field('delay', formatDelay(input.delay)) : '',
    typeof input.ttfb === 'number' ? field('ttfb', `${input.ttfb}ms`) : '',
    typeof input.warmup === 'number' ? field('warmup', `${input.warmup}ms`) : '',
    typeof input.measuredBytes === 'number'
      ? field('measured', `${input.measuredBytes}B`)
      : '',
    typeof input.speed === 'number' ? field('speed', formatSpeed(input.speed)) : '',
    input.message ? field('message', input.message, 600) : '',
  ].filter(Boolean)

  return limitText(fields.join(' | '), MAX_PAYLOAD_LENGTH)
}

function field(name: string, value: unknown, max = MAX_FIELD_LENGTH) {
  return `${name}=${limitText(redact(String(value)), max)}`
}

function redact(value: string) {
  return value
    .replace(
      /(error sending request for url\s+\()[^)]+(\))/gi,
      '$1[redacted-url]$2',
    )
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(
      /([?&](?:token|key|secret|password|passwd|auth|access_token|refresh_token)=)[^&\s]+/gi,
      '$1[redacted]',
    )
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/:\/\/([^:@/\s]+):([^@/\s]+)@/g, '://[redacted]@')
}

function limitText(value: string, max: number) {
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ')
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function clampLogs(input: ILogItem[]) {
  return input.length > MAX_TEST_LOGS ? input.slice(-MAX_TEST_LOGS) : input
}

function mergeLogs(current: ILogItem[], incoming: ILogItem[]) {
  const merged = current.concat(incoming)
  const seen = new Set<string>()
  const deduped: ILogItem[] = []

  for (const log of merged) {
    const key = `${log.time ?? ''}|${log.type}|${log.payload}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(log)
  }

  return deduped
}

function formatDelay(delay: number) {
  if (delay === 0) return 'timeout'
  if (delay > 1e5) return 'error'
  if (delay < 0) return '-'
  return `${delay}ms`
}

function formatSpeed(speed: number) {
  if (!Number.isFinite(speed) || speed < 0) return 'error'
  if (speed < 1024) return `${Math.round(speed)} B/s`
  if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(1)} KB/s`
  return `${(speed / 1024 / 1024).toFixed(2)} MB/s`
}
