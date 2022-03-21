// get the system os
// according to UA
export default function getSystem() {
  const ua = navigator.userAgent;

  if (ua.includes("Mac OS X")) return "macos";

  if (/win64|win32/i.test(ua)) return "windows";

  if (/linux/i.test(ua)) return "linux";

  return "unknown";
}
