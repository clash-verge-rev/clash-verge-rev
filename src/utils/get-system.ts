// get the system os
// according to UA
export default function getSystem() {
  const ua = navigator.userAgent
  const platform = OS_PLATFORM

  if (ua.includes('Mac OS X') || platform === 'darwin') return 'macos'

  if (/win64|win32/i.test(ua) || platform === 'win32') return 'windows'

  // FreeBSD desktop behavior (window control, TUN device name, DNS, font fallback, etc.) is consistent with Linux,
  // unified as 'linux' to reuse all Linux branches. webkit-gtk UA typically contains "Linux",
  // but explicitly check OS_PLATFORM to prevent falling to 'unknown' if UA doesn't contain it.
  if (/linux|freebsd/i.test(ua) || platform === 'freebsd') return 'linux'

  return 'unknown'
}
