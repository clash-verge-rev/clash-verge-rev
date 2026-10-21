import { save } from '@tauri-apps/plugin-dialog'

import {
  captureStatus,
  captureStart,
  captureStop,
  captureApi as invokeCaptureApi,
  captureCaExport,
  captureReplay,
} from './cmds'

export type { CaptureStatus } from './bindings'

export interface CaptureRule {
  id: number
  url: string
}

export interface CaptureSettings {
  enabled: boolean
  capture_all: boolean
  rules: CaptureRule[]
}

export interface CaptureBody {
  headers: [string, string][]
  body: string
  encoding: string
  bytes: number
  truncated: boolean
}

export interface CaptureFlow {
  id: string
  time: number
  method: string
  url: string
  status: number
  error: string
  content_type: string
  bytes: number
  request: CaptureBody | null
  response: CaptureBody | null
}

export interface CaptureFlowList {
  items: CaptureFlow[]
  total: number
  page: number
  pages: number
  page_size: number
  retained_limit?: number
  dropped?: number
}

export interface CaptureDomainCount {
  domain: string
  count: number
}

export interface CaptureQuery {
  page: number
  search: string
  domain: string
  status: string
  type: string
  method: string
}

const captureApi = <T>(
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
) =>
  invokeCaptureApi(
    method,
    path,
    body === undefined ? null : JSON.stringify(body),
  ) as unknown as Promise<T>

const withDomain = (path: string, domain: string) =>
  domain ? `${path}?domain=${encodeURIComponent(domain)}` : path

export const getCaptureStatus = () => captureStatus()
export const startCapture = () => captureStart()
export const stopCapture = () => captureStop()

/** Returns the saved path, or null when the user cancels the save dialog. */
export const exportCaptureCertificate = async () => {
  const path = await save({
    defaultPath: 'clash-capture-ca.pem',
    filters: [{ name: 'Certificate', extensions: ['pem', 'cer'] }],
  })
  return path ? captureCaExport(path) : null
}

export const getCaptureSettings = () =>
  captureApi<CaptureSettings>('GET', 'settings')

export const updateCaptureSettings = (enabled: boolean, captureAll: boolean) =>
  captureApi<CaptureSettings>('PUT', 'settings', {
    enabled,
    capture_all: captureAll,
  })

export const addCaptureRule = (url: string) =>
  captureApi<CaptureSettings>('POST', 'rules', { url })

export const removeCaptureRule = (id: number) =>
  captureApi<CaptureSettings>('DELETE', `rules/${id}`)

export const listCaptureFlows = ({
  page,
  search,
  domain,
  status,
  type,
  method,
}: CaptureQuery) => {
  const query = new URLSearchParams({ page: String(page), q: search, domain })

  for (const [key, value] of [
    ['status', status],
    ['type', type],
    ['method', method],
  ] as const) {
    if (value) query.set(key, value)
  }

  return captureApi<CaptureFlowList>('GET', `flows?${query}`)
}

export const getCaptureFlow = (id: string) =>
  captureApi<CaptureFlow>('GET', `flows/${id}`)

export const getCaptureFlowCount = (domain: string) =>
  captureApi<{ count: number }>('GET', withDomain('flow-count', domain))

export const getCaptureDomains = () =>
  captureApi<CaptureDomainCount[]>('GET', 'flow-domains')

export const clearCaptureFlows = (domain: string) =>
  captureApi<{ deleted: number }>('DELETE', withDomain('flows', domain))

export interface ReplayResult {
  status: number
  url: string
  response: CaptureBody
}
export const replayCaptureFlow = (id: string, query?: string, body?: string) =>
  captureReplay(
    id,
    query ?? null,
    body ?? null,
  ) as unknown as Promise<ReplayResult>
export const waitForCaptureChanges = (since: number) =>
  captureApi<{ revision: number }>('GET', `changes?since=${since}`)
