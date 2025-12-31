import {
  decodeBase64OrOriginal,
  getCipher,
  getIfNotBlank,
  parseQueryString,
  parseRequiredPort,
  stripUriScheme,
} from "./helpers";

export function URI_SSR(line: string): IProxyshadowsocksRConfig {
  const afterScheme = stripUriScheme(line, "ssr", "Invalid ssr uri");
  if (!afterScheme) {
    throw new Error("Invalid ssr uri");
  }
  line = decodeBase64OrOriginal(afterScheme);

  // handle IPV6 & IPV4 format
  let splitIdx = line.indexOf(":origin");
  if (splitIdx === -1) {
    splitIdx = line.indexOf(":auth_");
  }
  if (splitIdx === -1) {
    throw new Error("Invalid ssr uri");
  }
  const serverAndPort = line.substring(0, splitIdx);
  const portIdx = serverAndPort.lastIndexOf(":");
  if (portIdx === -1) {
    throw new Error("Invalid ssr uri: missing port");
  }
  const server = serverAndPort.substring(0, portIdx);
  const port = parseRequiredPort(
    serverAndPort.substring(portIdx + 1),
    "Invalid ssr uri: invalid port",
  );

  const params = line
    .substring(splitIdx + 1)
    .split("/?")[0]
    .split(":");
  let proxy: IProxyshadowsocksRConfig = {
    name: "SSR",
    type: "ssr",
    server,
    port,
    protocol: params[0],
    cipher: getCipher(params[1]),
    obfs: params[2],
    password: decodeBase64OrOriginal(params[3]),
  };

  // get other params
  const otherParams: Record<string, string> = {};
  const rawOtherParams = parseQueryString(line.split("/?")[1]);
  for (const [key, value] of Object.entries(rawOtherParams)) {
    const trimmed = value?.trim();
    if (trimmed) {
      otherParams[key] = trimmed;
    }
  }

  proxy = {
    ...proxy,
    name: otherParams.remarks
      ? decodeBase64OrOriginal(otherParams.remarks).trim()
      : (proxy.server ?? ""),
    "protocol-param": getIfNotBlank(
      decodeBase64OrOriginal(otherParams.protoparam || "").replace(/\s/g, ""),
    ),
    "obfs-param": getIfNotBlank(
      decodeBase64OrOriginal(otherParams.obfsparam || "").replace(/\s/g, ""),
    ),
  };
  return proxy;
}
