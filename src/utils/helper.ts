import ipaddr from "ipaddr.js";

import { debugLog } from "@/utils/debug";

export type HostKind = "localhost" | "domain" | "ipv4" | "ipv6";

export type ParsedHost = {
  kind: HostKind;
  host: string;
};

export const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    debugLog(e);
    return false;
  }
};

export const isValidPort = (port: string) => {
  const portNumber = Number(port);
  return Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536;
};

export const isValidDomain = (domain: string) => {
  try {
    const url = new URL(`http://${domain}`);
    return url.hostname.toLowerCase() === domain.toLowerCase();
  } catch {
    return false;
  }
};

const isLocalhostString = (host: string) => {
  const lowerHost = host.toLowerCase();
  return lowerHost === "localhost";
};

const stripBrackets = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

export const parseHost = (host: string): ParsedHost | null => {
  // 去除前后空白
  host = host.trim();
  // 优先检测 localhost
  if (isLocalhostString(host)) {
    return { kind: "localhost", host: "localhost" };
  }
  // 除去方括号后检测 IP
  const strippedHost = stripBrackets(host);
  // IPv4
  if (ipaddr.IPv4.isValidFourPartDecimal(strippedHost)) {
    return { kind: "ipv4", host: strippedHost };
  }
  // IPv6
  if (ipaddr.IPv6.isValid(strippedHost)) {
    return { kind: "ipv6", host: strippedHost };
  }
  // 再检测 domain, 防止像 [::1] 这样的合法 IPv6 地址被误判为域名
  if (isValidDomain(host)) {
    return { kind: "domain", host };
  }
  // 都不是
  return null;
};

const LISTEN_CIDRS_V4 = [
  "0.0.0.0/32", // any
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // RFC1918
  "172.16.0.0/12", // RFC1918
  "192.168.0.0/16", // RFC1918
];

const LISTEN_CIDRS_V6 = [
  "::/128", // any
  "::1/128", // loopback
  "fc00::/7", // ULA（LAN）
  "fe80::/10", // link-local
];

export const parsedLocalhost = (host: string): ParsedHost | null => {
  // 先 parse 一下
  const parsed = parseHost(host);
  if (!parsed) return null;
  // localhost 直接通过
  if (parsed.kind === "localhost") {
    return parsed;
  }
  // IP 则检查是否在允许的 CIDR 列表内
  if (parsed.kind === "ipv4") {
    // IPv4
    const addr = ipaddr.IPv4.parse(parsed.host);
    for (const cidr of LISTEN_CIDRS_V4) {
      if (addr.match(ipaddr.IPv4.parseCIDR(cidr))) {
        return parsed;
      }
    }
  } else if (parsed.kind === "ipv6") {
    // IPv6
    const addr = ipaddr.IPv6.parse(parsed.host);
    for (const cidr of LISTEN_CIDRS_V6) {
      if (addr.match(ipaddr.IPv6.parseCIDR(cidr))) {
        return parsed;
      }
    }
  }
  // domain和都不符合则返回 null
  return null;
};
