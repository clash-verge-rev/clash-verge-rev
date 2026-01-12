import { isValid } from "ipaddr.js";

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

export const isValidPort = (port: string) => {
  const portNumber = Number(port);
  return Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536;
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
  return isValidDomain(host) || isValid(host) || isLocalhost(host);
};

// 0-255
const IPv4SegmentFormat =
  "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";

const LocalhostIPv4RegExp = new RegExp(`^127(?:\\.${IPv4SegmentFormat}){3}$`);

export function isLocalhost(ipAddress: string): boolean {
  const normalizedIp = ipAddress.toLowerCase();
  return (
    normalizedIp === "localhost" ||
    normalizedIp === "::1" ||
    normalizedIp === "[::1]" ||
    LocalhostIPv4RegExp.test(normalizedIp)
  );
}
