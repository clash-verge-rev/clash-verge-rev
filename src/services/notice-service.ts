import i18n from 'i18next'
import { ReactNode, isValidElement } from 'react'

import type { FailedOperation } from '@/services/cmds'
import type { TranslationKey } from '@/types/generated/i18n-keys'

type NoticeType = 'success' | 'error' | 'info'

interface NoticeTranslationDescriptor {
  key: string
  params?: Record<string, unknown>
}

interface NoticeItem {
  readonly id: number
  readonly type: NoticeType
  readonly duration: number
  readonly message?: ReactNode
  readonly i18n?: NoticeTranslationDescriptor
  readonly code?: string
  readonly operation?: FailedOperation
  timerId?: ReturnType<typeof setTimeout>
}

const CODES_A_DIALOG_REPORTS = new Set<string>([
  'SYSPROXY_PRIVILEGE_REQUIRED',
  'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
])

const isReportedByDialog = (code: string | undefined): boolean =>
  code !== undefined && CODES_A_DIALOG_REPORTS.has(code)

type NoticeContent = unknown

type NoticeExtra = unknown

type NoticeShortcut = (
  message: NoticeContent,
  ...extras: NoticeExtra[]
) => number

type ShowNotice = ((
  type: NoticeType,
  message: NoticeContent,
  ...extras: NoticeExtra[]
) => number) & {
  success: NoticeShortcut
  error: NoticeShortcut
  info: NoticeShortcut
}

type NoticeSubscriber = () => void

const DEFAULT_DURATIONS: Readonly<Record<NoticeType, number>> = {
  success: 3000,
  info: 5000,
  error: 8000,
}

const TRANSLATION_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/
const CODED_ERROR_TRANSLATION_KEYS: Readonly<Record<string, TranslationKey>> = {
  CLASH_CONFIG_UPDATE_FAILED:
    'settings.feedback.errors.clash.configUpdateFailed',
  CLASH_MODE_UPDATE_FAILED: 'settings.feedback.errors.clash.modeUpdateFailed',
  CORE_CHANGE_FAILED: 'settings.feedback.notifications.clash.changeFailed',
  CORE_RESTART_FAILED: 'settings.feedback.errors.clash.restartFailed',
  CORE_START_FAILED: 'settings.feedback.errors.clash.startFailed',
  CORE_STOP_FAILED: 'settings.feedback.errors.clash.stopFailed',
  PROFILE_CREATE_FAILED: 'profiles.page.feedback.errors.createFailed',
  PROFILE_DELETE_FAILED: 'profiles.page.feedback.errors.deleteFailed',
  PROFILE_ENHANCE_FAILED: 'profiles.page.feedback.errors.enhanceFailed',
  PROFILE_IMPORT_FAILED: 'profiles.page.feedback.errors.importFailed',
  PROFILE_OPEN_FAILED: 'profiles.page.feedback.errors.openFailed',
  PROFILE_READ_FAILED: 'profiles.page.feedback.errors.readFailed',
  PROFILE_REORDER_FAILED: 'profiles.page.feedback.errors.reorderFailed',
  PROFILE_SWITCH_FAILED: 'profiles.page.feedback.errors.switchFailed',
  PROFILE_UPDATE_FAILED: 'profiles.page.feedback.errors.updateFailed',
  SERVICE_INSTALL_FAILED: 'settings.feedback.errors.clashService.installFailed',
  SERVICE_REINSTALL_FAILED:
    'settings.feedback.errors.clashService.reinstallFailed',
  SERVICE_REPAIR_FAILED: 'settings.feedback.errors.clashService.repairFailed',
  SERVICE_SIDECAR_FAILED: 'settings.feedback.errors.clashService.sidecarFailed',
  SERVICE_UNINSTALL_FAILED:
    'settings.feedback.errors.clashService.uninstallFailed',
  SYSPROXY_DIRECT_FALLBACK: 'settings.feedback.errors.sysproxy.directFallback',
  SYSPROXY_GUARD_STOPPED: 'settings.feedback.errors.sysproxy.guardStopped',
  SYSPROXY_SIDECAR_WHILE_SERVICE_READY:
    'settings.feedback.errors.sysproxy.sidecarWhileServiceReady',
  SYSPROXY_PRIVILEGE_REQUIRED:
    'settings.feedback.errors.sysproxy.privilegeRequired',
}

let nextId = 0
let notices: NoticeItem[] = []
const subscribers: Set<NoticeSubscriber> = new Set()

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber())
}

interface ParsedNoticeExtras {
  params?: Record<string, unknown>
  raw?: unknown
  duration?: number
  nestedCode?: string
}

function parseNoticeExtras(extras: NoticeExtra[]): ParsedNoticeExtras {
  let params: Record<string, unknown> | undefined
  let raw: unknown
  let duration: number | undefined

  // Prioritize objects as translation params, then as raw payloads, while the first number wins as duration.
  for (const extra of extras) {
    if (extra === undefined) continue

    if (typeof extra === 'number' && duration === undefined) {
      duration = extra
      continue
    }

    // Parse command failures before generic translation params.
    if (isCommandFailure(extra)) {
      if (!raw) {
        raw = extra
        continue
      }
    }

    if (isPlainRecord(extra)) {
      if (!params) {
        params = extra
        continue
      }
      if (!raw) {
        raw = extra
        continue
      }
    }

    if (!raw) {
      raw = extra
      continue
    }

    if (!params && isPlainRecord(extra)) {
      params = extra
      continue
    }

    if (duration === undefined && typeof extra === 'number') {
      duration = extra
    }
  }

  return {
    params: params && readableParams(params),
    raw,
    duration,
    nestedCode: nestedFailureCode(params),
  }
}

function readableParams(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      isCommandFailure(value) ? value.detail : value,
    ]),
  )
}

function nestedFailureCode(
  source?: Record<string, unknown>,
): string | undefined {
  if (!source) return undefined
  for (const value of Object.values(source)) {
    if (isCommandFailure(value) && value.code) return value.code
  }
  return undefined
}

function resolveDuration(type: NoticeType, override?: number) {
  return override ?? DEFAULT_DURATIONS[type]
}

function buildNotice(
  id: number,
  type: NoticeType,
  duration: number,
  payload: {
    message?: ReactNode
    i18n?: NoticeTranslationDescriptor
    code?: string
    operation?: FailedOperation
  },
  timerId?: ReturnType<typeof setTimeout>,
): NoticeItem {
  return {
    id,
    type,
    duration,
    timerId,
    ...payload,
  }
}

function isMaybeTranslationDescriptor(
  message: unknown,
): message is NoticeTranslationDescriptor {
  if (
    typeof message === 'object' &&
    message !== null &&
    !Array.isArray(message) &&
    !isValidElement(message)
  ) {
    return typeof (message as Record<string, unknown>).key === 'string'
  }
  return false
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Error ||
    isValidElement(value)
  ) {
    return false
  }

  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const MAX_RENDERED_TEXT_CHARS = 500

export function boundNoticeText(text: string): string {
  let end = 0
  let counted = 0
  for (const codePoint of text) {
    if (counted === MAX_RENDERED_TEXT_CHARS) {
      return `${text.slice(0, end).trimEnd()}…`
    }
    end += codePoint.length
    counted += 1
  }
  return text
}

function createRawDescriptor(message: string): NoticeTranslationDescriptor {
  return {
    key: 'shared.feedback.notices.raw',
    params: { message },
  }
}

const MAX_TRANSLATION_KEY_CHARS = 200

function isLikelyTranslationKey(key: string) {
  return (
    key.length <= MAX_TRANSLATION_KEY_CHARS && TRANSLATION_KEY_PATTERN.test(key)
  )
}

function shouldUseTranslationKey(
  key: string,
  params?: Record<string, unknown>,
) {
  if (params && Object.keys(params).length > 0) return true
  if (isLikelyTranslationKey(key)) return true
  if (i18n.isInitialized) {
    return i18n.exists(key)
  }
  return false
}

function extractDisplayText(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined
  if (typeof input === 'string') return input
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input)
  }
  if (input instanceof Error) {
    return input.message || input.name
  }
  if (isCommandFailure(input)) return input.detail
  if (typeof input === 'object' && input !== null) {
    const maybeMessage = (input as { message?: unknown }).message
    if (typeof maybeMessage === 'string') return maybeMessage
  }
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

export interface CommandFailure {
  code?: string
  operation?: FailedOperation
  detail: string
}

function isCommandFailure(input: unknown): input is CommandFailure {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<CommandFailure>
  return (
    typeof candidate.detail === 'string' &&
    (candidate.code === undefined || typeof candidate.code === 'string')
  )
}

export function errorDetail(input: unknown): string {
  return extractDisplayText(input) ?? ''
}

function parseCommandFailure(input: unknown) {
  if (!isCommandFailure(input) || !input.code) return undefined

  const explanation = CODED_ERROR_TRANSLATION_KEYS[input.code]
  return {
    translationKey: explanation ?? 'shared.feedback.errors.operationFailed',
    explained: explanation !== undefined,
    detail: input.detail.trim() || undefined,
  }
}

function normalizeNoticeMessage(
  message: NoticeContent,
  params?: Record<string, unknown>,
  raw?: unknown,
): { message?: ReactNode; i18n?: NoticeTranslationDescriptor } {
  const rawText = raw !== undefined ? extractDisplayText(raw) : undefined
  const parsedRawError = parseCommandFailure(raw)
  const rawDetail = parsedRawError?.detail ?? rawText

  if (isValidElement(message)) {
    return { message }
  }

  if (isMaybeTranslationDescriptor(message)) {
    const originalParams = readableParams(message.params ?? {})
    const mergedParams = Object.keys(params ?? {}).length
      ? { ...originalParams, ...params }
      : { ...originalParams }

    if (rawDetail !== undefined) {
      return {
        i18n: {
          key: 'shared.feedback.notices.prefixedRaw',
          params: {
            ...mergedParams,
            prefixKey: message.key,
            prefixParams: originalParams,
            message: rawDetail,
          },
        },
      }
    }

    return {
      i18n: {
        key: message.key,
        params: Object.keys(mergedParams).length ? mergedParams : undefined,
      },
    }
  }

  const parsedMessageError = parseCommandFailure(message)
  if (parsedMessageError) {
    if (!parsedMessageError.detail) {
      return {
        i18n: {
          key: parsedMessageError.translationKey,
        },
      }
    }
    return {
      i18n: {
        key: 'shared.feedback.notices.prefixedRaw',
        params: {
          prefixKey: parsedMessageError.translationKey,
          message: parsedMessageError.detail,
        },
      },
    }
  }

  if (typeof message === 'string') {
    if (rawDetail !== undefined) {
      if (shouldUseTranslationKey(message, params)) {
        // A mapped cause outranks a translation key that only names the operation.
        const prefixKey = parsedRawError?.explained
          ? parsedRawError.translationKey
          : message

        return {
          i18n: {
            key: 'shared.feedback.notices.prefixedRaw',
            params: {
              ...(params ?? {}),
              prefixKey,
              message: rawDetail,
            },
          },
        }
      }
      // Prefer showing the original string while still surfacing the raw details below.
      return {
        i18n: {
          key: 'shared.feedback.notices.prefixedRaw',
          params: {
            ...(params ?? {}),
            prefix: message,
            message: rawDetail,
          },
        },
      }
    }

    if (shouldUseTranslationKey(message, params)) {
      return {
        i18n: {
          key: message,
          params: params && Object.keys(params).length ? params : undefined,
        },
      }
    }
    return { i18n: createRawDescriptor(message) }
  }

  if (rawDetail !== undefined) {
    return { i18n: createRawDescriptor(rawDetail) }
  }

  const extracted = extractDisplayText(message)
  if (extracted !== undefined) {
    return { i18n: createRawDescriptor(extracted) }
  }

  return { i18n: createRawDescriptor('') }
}

const baseShowNotice = (
  type: NoticeType,
  message: NoticeContent,
  ...extras: NoticeExtra[]
): number => {
  const id = nextId++
  const { params, raw, duration, nestedCode } = parseNoticeExtras(extras)
  // Accept codes from raw, direct, or interpolated failures.
  const code = failureCode(raw) ?? failureCode(message) ?? nestedCode
  const operation = failureOperation(raw) ?? failureOperation(message)
  // Suppress duplicate toasts while preserving the caller's id contract.
  if (isReportedByDialog(code)) return id
  const effectiveDuration = resolveDuration(type, duration)
  const timerId =
    effectiveDuration > 0
      ? setTimeout(() => hideNotice(id), effectiveDuration)
      : undefined

  const normalizedMessage = normalizeNoticeMessage(message, params, raw)
  const notice = buildNotice(
    id,
    type,
    effectiveDuration,
    { ...normalizedMessage, code, operation },
    timerId,
  )

  // Replace older notices for the same failure code.
  if (code) {
    notices
      .filter((existing) => existing.code === code)
      .forEach((existing) => {
        if (existing.timerId) clearTimeout(existing.timerId)
      })
    notices = notices.filter((existing) => existing.code !== code)
  }

  notices = [...notices, notice]
  notifySubscribers()
  return id
}

function failureCode(input: unknown): string | undefined {
  return isCommandFailure(input) ? input.code : undefined
}

function failureOperation(input: unknown): FailedOperation | undefined {
  return isCommandFailure(input) ? input.operation : undefined
}

/**
 * Shows a global notice. Extras are parsed as i18n params, raw payload, then duration;
 * returns an ID accepted by `hideNotice`.
 */
export const showNotice: ShowNotice = Object.assign(baseShowNotice, {
  success: (message: NoticeContent, ...extras: NoticeExtra[]) =>
    baseShowNotice('success', message, ...extras),
  error: (message: NoticeContent, ...extras: NoticeExtra[]) =>
    baseShowNotice('error', message, ...extras),
  info: (message: NoticeContent, ...extras: NoticeExtra[]) =>
    baseShowNotice('info', message, ...extras),
})

export function hideNotice(id: number) {
  const notice = notices.find((candidate) => candidate.id === id)
  if (notice?.timerId) {
    clearTimeout(notice.timerId)
  }
  notices = notices.filter((candidate) => candidate.id !== id)
  notifySubscribers()
}

export function subscribeNotices(subscriber: NoticeSubscriber) {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export function getSnapshotNotices() {
  return notices
}
