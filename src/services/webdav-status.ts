export type WebdavStatus = 'unknown' | 'ready' | 'failed'

interface WebdavStatusCache {
  signature: string
  status: WebdavStatus
  updatedAt: number
}

const WEBDAV_STATUS_KEY = 'webdav_status_cache'

export const buildWebdavSignature = (
  verge?: Pick<
    IVergeConfig,
    | 'webdav_url'
    | 'webdav_username'
    | 'webdav_password'
    | 'webdav_danger_accept_invalid_certs'
  > | null,
) => {
  const url = verge?.webdav_url?.trim() ?? ''
  const username = verge?.webdav_username?.trim() ?? ''
  const password = verge?.webdav_password ?? ''
  const dangerAcceptInvalidCerts =
    verge?.webdav_danger_accept_invalid_certs ?? false

  if (!url && !username && !password && !dangerAcceptInvalidCerts) return ''

  return JSON.stringify([url, username, password, dangerAcceptInvalidCerts])
}

const canUseStorage = () => typeof localStorage !== 'undefined'

export const getWebdavStatus = (signature: string): WebdavStatus => {
  if (!signature || !canUseStorage()) return 'unknown'

  const raw = localStorage.getItem(WEBDAV_STATUS_KEY)
  if (!raw) return 'unknown'

  try {
    const data = JSON.parse(raw) as Partial<WebdavStatusCache>
    if (!data || data.signature !== signature) return 'unknown'
    return data.status === 'ready' || data.status === 'failed'
      ? data.status
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

export const setWebdavStatus = (signature: string, status: WebdavStatus) => {
  if (!signature || !canUseStorage()) return

  const payload: WebdavStatusCache = {
    signature,
    status,
    updatedAt: Date.now(),
  }

  localStorage.setItem(WEBDAV_STATUS_KEY, JSON.stringify(payload))
}
