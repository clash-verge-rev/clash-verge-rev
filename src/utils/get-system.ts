// get the system os
// according to UA
export default function getSystem() {
  const ua = navigator.userAgent;
  const platform = OS_PLATFORM;

  // Precompiled regex for reuse
  const WIN_RE = /win64|win32/i;
  const LINUX_RE = /linux/i;

  if (ua.indexOf("Mac OS X") !== -1 || platform === "darwin") return "macos";

  if (WIN_RE.test(ua) || platform === "win32") return "windows";

  if (LINUX_RE.test(ua)) return "linux";

  return "unknown";
}
