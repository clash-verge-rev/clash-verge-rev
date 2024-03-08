// get the system os
// according to UA
export default function getSystem() {
  const ua = navigator.userAgent;
  const platform = OS_PLATFORM;

  if (ua.includes("Mac OS X") || platform === "darwin") return "macos";

  if (/win64|win32/i.test(ua) || platform === "win32") return "windows";

  if (/linux/i.test(ua)) return "linux";

  return "unknown";
}
