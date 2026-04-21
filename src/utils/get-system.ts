const WIN_UA_RE = /win64|win32/i
const LINUX_UA_RE = /linux/i

export default function getSystem() {
  const ua = navigator.userAgent
  const platform = OS_PLATFORM

  if (ua.includes('Mac OS X') || platform === 'darwin') return 'macos'

  if (WIN_UA_RE.test(ua) || platform === 'win32') return 'windows'

  if (LINUX_UA_RE.test(ua)) return 'linux'

  return 'unknown'
}
