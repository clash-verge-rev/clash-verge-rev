import { debugLog } from "@/utils/debug";

export const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    debugLog(e);
    return false;
  }
};

export const isValidDomain = (domain: string) => {
  try {
    const url = new URL(`http://${domain}`);
    return url.hostname === domain;
  } catch (e) {
    debugLog(e);
    return false;
  }
};

export const isValidHost = (host: string) => {
  return (
    isValidDomain(host) || isIP(host) || isIPWithPort(host) || isLocalhost(host)
  );
};

type IPVersion = 4 | 6;

interface IsIPOptions {
  version?: IPVersion;
}

// 1-65535
const PortFormat =
  "(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])";

// 0-255
const IPv4SegmentFormat =
  "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
const IPv4AddressFormat = `(${IPv4SegmentFormat}[.]){3}${IPv4SegmentFormat}`;
const IPv4WithPortFormat = `^${IPv4AddressFormat}(:${PortFormat})?$`;
const IPv4AddressRegExp = new RegExp(`^${IPv4AddressFormat}$`);
const IPv4WithPortRegExp = new RegExp(IPv4WithPortFormat);

const IPv6SegmentFormat = "(?:[0-9a-fA-F]{1,4})";
const IPv6AddressFormat =
  "(" +
  `(?:${IPv6SegmentFormat}:){7}(?:${IPv6SegmentFormat}|:)|` +
  `(?:${IPv6SegmentFormat}:){6}(?:${IPv4AddressFormat}|:${IPv6SegmentFormat}|:)|` +
  `(?:${IPv6SegmentFormat}:){5}(?::${IPv4AddressFormat}|(:${IPv6SegmentFormat}){1,2}|:)|` +
  `(?:${IPv6SegmentFormat}:){4}(?:(:${IPv6SegmentFormat}){0,1}:${IPv4AddressFormat}|(:${IPv6SegmentFormat}){1,3}|:)|` +
  `(?:${IPv6SegmentFormat}:){3}(?:(:${IPv6SegmentFormat}){0,2}:${IPv4AddressFormat}|(:${IPv6SegmentFormat}){1,4}|:)|` +
  `(?:${IPv6SegmentFormat}:){2}(?:(:${IPv6SegmentFormat}){0,3}:${IPv4AddressFormat}|(:${IPv6SegmentFormat}){1,5}|:)|` +
  `(?:${IPv6SegmentFormat}:){1}(?:(:${IPv6SegmentFormat}){0,4}:${IPv4AddressFormat}|(:${IPv6SegmentFormat}){1,6}|:)|` +
  `(?::((?::${IPv6SegmentFormat}){0,5}:${IPv4AddressFormat}|(?::${IPv6SegmentFormat}){1,7}|:))` +
  ")(%[0-9a-zA-Z.]{1,})?";
const IPv6AddressRegExp = new RegExp(`^${IPv6AddressFormat}$`);
const IPv6WithPortFormat = `^\\[${IPv6AddressFormat}\\](?::${PortFormat})?$`;
const IPv6WithPortRegExp = new RegExp(IPv6WithPortFormat);

const LocalhostIPv4RegExp = new RegExp(`^127(?:\\.${IPv4SegmentFormat}){3}$`);

export default function isIP(
  ipAddress: string,
  options: IsIPOptions = {},
): boolean {
  // 从 options 获取 version，默认为空字符串
  const version = options.version || "";

  // 如果没有指定 version，则检查是否为 IPv4 或 IPv6
  if (!version) {
    return isIP(ipAddress, { version: 4 }) || isIP(ipAddress, { version: 6 });
  }

  // 如果指定了 version 为 4，使用 IPv4 正则进行检查
  if (version === 4) {
    return IPv4AddressRegExp.test(ipAddress);
  }

  // 如果指定了 version 为 6，使用 IPv6 正则进行检查
  if (version === 6) {
    return IPv6AddressRegExp.test(ipAddress);
  }

  return false;
}

export function isIPWithPort(
  ipAddress: string,
  options: IsIPOptions = {},
): boolean {
  // 从 options 获取 version，默认为空字符串
  const version = options.version || "";

  // 如果没有指定 version，则检查是否为 IPv4 或 IPv6
  if (!version) {
    return (
      isIPWithPort(ipAddress, { version: 4 }) ||
      isIPWithPort(ipAddress, { version: 6 })
    );
  }

  // 如果指定了 version 为 4，使用 IPv4 带端口正则进行检查
  if (version === 4) {
    return IPv4WithPortRegExp.test(ipAddress);
  }

  // 如果指定了 version 为 6，使用 IPv6 带端口正则进行检查
  if (version === 6) {
    return IPv6WithPortRegExp.test(ipAddress);
  }

  return false;
}

export function isLocalhost(ipAddress: string): boolean {
  const normalizedIp = ipAddress.toLowerCase();
  return (
    normalizedIp === "localhost" ||
    normalizedIp === "::1" ||
    normalizedIp === "[::1]" ||
    LocalhostIPv4RegExp.test(normalizedIp)
  );
}
