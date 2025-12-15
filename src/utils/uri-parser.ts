type UriParser = (uri: string) => IProxyConfig;

const URI_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

const URI_PARSERS: Record<string, UriParser> = {
  ss: URI_SS,
  ssr: URI_SSR,
  vmess: URI_VMESS,
  vless: URI_VLESS,
  trojan: URI_Trojan,
  hysteria2: URI_Hysteria2,
  hy2: URI_Hysteria2,
  hysteria: URI_Hysteria,
  hy: URI_Hysteria,
  tuic: URI_TUIC,
  wireguard: URI_Wireguard,
  wg: URI_Wireguard,
  http: URI_HTTP,
  https: URI_HTTP,
  socks5: URI_SOCKS,
  socks: URI_SOCKS,
};

function normalizeUriAndGetScheme(input: string): {
  uri: string;
  scheme: string;
} {
  const trimmed = input.trim();
  const match = URI_SCHEME_RE.exec(trimmed);
  if (!match) {
    const schemeGuess = (trimmed.split("://")[0] ?? "").toLowerCase();
    return { uri: trimmed, scheme: schemeGuess };
  }

  const scheme = match[1].toLowerCase();
  return { uri: scheme + trimmed.slice(match[1].length), scheme };
}

function stripUriScheme(
  uri: string,
  expectedSchemes: string | readonly string[],
  errorMessage: string,
): string {
  const match = URI_SCHEME_RE.exec(uri);
  if (!match) {
    throw new Error(errorMessage);
  }
  const scheme = match[1].toLowerCase();

  const expected =
    typeof expectedSchemes === "string" ? [expectedSchemes] : expectedSchemes;
  if (!expected.includes(scheme)) {
    throw new Error(errorMessage);
  }
  return uri.slice(match[0].length);
}

export default function parseUri(uri: string): IProxyConfig {
  const { uri: normalized, scheme } = normalizeUriAndGetScheme(uri);
  const parser = URI_PARSERS[scheme];
  if (!parser) {
    throw new Error(`Unknown uri type: ${scheme}`);
  }
  return parser(normalized);
}

function getIfNotBlank(
  value: string | undefined,
  dft?: string,
): string | undefined {
  return value && value.trim() !== "" ? value : dft;
}

function getIfPresent<T>(value: T | null | undefined, dft?: T): T | undefined {
  return value !== null && value !== undefined ? value : dft;
}

function isPresent(value: any): boolean {
  return value !== null && value !== undefined;
}

function trimStr(str: string | undefined): string | undefined {
  return str ? str.trim() : str;
}

function safeDecodeURIComponent(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeAndTrim(value: string | undefined): string | undefined {
  const decoded = safeDecodeURIComponent(value);
  const trimmed = decoded?.trim();
  return trimmed ? trimmed : undefined;
}

function splitOnce(input: string, delimiter: string): [string, string?] {
  const idx = input.indexOf(delimiter);
  if (idx === -1) return [input];
  return [input.slice(0, idx), input.slice(idx + delimiter.length)];
}

function parseQueryString(
  query: string | undefined,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!query) return out;
  for (const part of query.split("&")) {
    if (!part) continue;
    const [keyRaw, valueRaw] = splitOnce(part, "=");
    const key = keyRaw.trim();
    if (!key) continue;
    out[key] =
      valueRaw === undefined
        ? undefined
        : (safeDecodeURIComponent(valueRaw) ?? valueRaw);
  }
  return out;
}

function normalizeQueryKey(key: string): string {
  return key.replace(/_/g, "-");
}

function parseQueryStringNormalized(
  query: string | undefined,
): Record<string, string | undefined> {
  const raw = parseQueryString(query);
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[normalizeQueryKey(key)] = value;
  }
  return normalized;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return /^(?:true|1)$/i.test(value);
}

function parseBoolOrPresence(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return /^(?:true|1)$/i.test(trimmed);
}

function parseVlessFlow(value: string | undefined): string | undefined {
  const flow = getIfNotBlank(value);
  if (!flow) return undefined;
  if (/^none$/i.test(flow)) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(flow)) return undefined;
  return flow;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parsePortStrict(
  value: string | number | null | undefined,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }
  return parsed;
}

function parseRequiredPort(
  value: string | number | null | undefined,
  errorMessage: string,
): number {
  const parsed = parsePortStrict(value);
  if (parsed === undefined) {
    throw new Error(errorMessage);
  }
  return parsed;
}

function parsePortOrDefault(port: string | undefined, dft: number): number {
  return parseInteger(port) ?? dft;
}

const IP_VERSIONS = [
  "dual",
  "ipv4",
  "ipv6",
  "ipv4-prefer",
  "ipv6-prefer",
] as const;

function parseIpVersion(
  value: string | undefined,
): (typeof IP_VERSIONS)[number] {
  return value && IP_VERSIONS.includes(value as (typeof IP_VERSIONS)[number])
    ? (value as (typeof IP_VERSIONS)[number])
    : "dual";
}

type UrlLikeParts = {
  auth?: string;
  host: string;
  port?: string;
  query?: string;
  fragment?: string;
};

const URLLIKE_RE =
  /^(?:(?<auth>.*?)@)?(?<host>.*?)(?::(?<port>\d+))?\/?(?:\?(?<query>.*?))?(?:#(?<fragment>.*?))?$/;

function parseUrlLike(
  input: string,
  options: { requireAuth: true; errorMessage: string },
): UrlLikeParts & { auth: string };
function parseUrlLike(
  input: string,
  options: { requireAuth?: false; errorMessage: string },
): UrlLikeParts;
function parseUrlLike(
  input: string,
  options: { requireAuth?: boolean; errorMessage: string },
): UrlLikeParts {
  const match = URLLIKE_RE.exec(input);
  const groups = (match?.groups ?? {}) as {
    auth?: string;
    host?: string;
    port?: string;
    query?: string;
    fragment?: string;
  };
  if (!match || groups.host === undefined) {
    throw new Error(options.errorMessage);
  }

  const auth = getIfNotBlank(groups.auth);
  if (options.requireAuth && !auth) {
    throw new Error(options.errorMessage);
  }

  const result: UrlLikeParts = {
    auth,
    host: groups.host,
    port: groups.port,
    query: groups.query,
    fragment: groups.fragment,
  };
  return options.requireAuth
    ? ({ ...result, auth } as UrlLikeParts & { auth: string })
    : result;
}

function isIPv4(address: string): boolean {
  // Check if the address is IPv4
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  return ipv4Regex.test(address);
}

function isIPv6(address: string): boolean {
  // Check if the address is IPv6 - simplified regex to avoid backreference issues
  const ipv6Regex =
    /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$|^([0-9a-fA-F]{1,4}:)*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(address);
}

function decodeBase64OrOriginal(str: string): string {
  const normalized = str
    .replace(/[\r\n\s]/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padLen = normalized.length % 4;
  const padded =
    padLen === 0 ? normalized : normalized + "=".repeat(4 - padLen);

  try {
    const decoded = atob(padded);
    // Heuristic: only accept "text-like" results to avoid accidentally decoding
    // non-base64 strings that happen to be decodable.
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) continue;
      if (code < 32 || code === 127) {
        return str;
      }
    }
    return decoded;
  } catch {
    return str;
  }
}

const CIPHER_ALIASES: Record<string, CipherType> = {
  "chacha20-poly1305": "chacha20-ietf-poly1305",
};

const KNOWN_CIPHERS = new Set<CipherType>([
  "none",
  "auto",
  "dummy",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "lea-128-gcm",
  "lea-192-gcm",
  "lea-256-gcm",
  "aes-128-gcm-siv",
  "aes-256-gcm-siv",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "aes-128-cfb",
  "aes-192-cfb",
  "aes-256-cfb",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "chacha20",
  "chacha20-ietf",
  "chacha20-ietf-poly1305",
  "2022-blake3-chacha20-poly1305",
  "rabbit128-poly1305",
  "xchacha20-ietf-poly1305",
  "xchacha20",
  "aegis-128l",
  "aegis-256",
  "aez-384",
  "deoxys-ii-256-128",
  "rc4-md5",
]);

function getCipher(value: unknown): CipherType {
  if (value === undefined) return "none";
  if (typeof value !== "string") return "auto";
  const aliased = CIPHER_ALIASES[value] ?? value;
  return KNOWN_CIPHERS.has(aliased as CipherType)
    ? (aliased as CipherType)
    : "auto";
}

function firstString(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const first = value[0];
    return first === null || first === undefined ? undefined : String(first);
  }
  return String(value);
}

function parseVmessShadowrocketParams(raw: string): Record<string, any> {
  const match = /(^[^?]+?)\/?\?(.*)$/.exec(raw);
  if (!match) return {};

  const [, base64Line, qs] = match;
  const content = decodeBase64OrOriginal(base64Line);
  const params: Record<string, any> = {};

  for (const addon of qs.split("&")) {
    if (!addon) continue;
    const [keyRaw, valueRaw] = splitOnce(addon, "=");
    const key = keyRaw.trim();
    if (!key) continue;
    if (valueRaw === undefined) {
      params[key] = true;
      continue;
    }
    const value = safeDecodeURIComponent(valueRaw) ?? valueRaw;
    params[key] = value.includes(",") ? value.split(",") : value;
  }

  const contentMatch = /(^[^:]+?):([^:]+?)@(.*):(\d+)$/.exec(content);
  if (!contentMatch) return params;

  const [, cipher, uuid, server, port] = contentMatch;
  params.scy = cipher;
  params.id = uuid;
  params.port = port;
  params.add = server;
  return params;
}

function parseVmessParams(decoded: string, raw: string): Record<string, any> {
  try {
    // V2rayN URI format
    return JSON.parse(decoded);
  } catch (e) {
    // Shadowrocket URI format
    console.warn(
      "[URI_VMESS] JSON.parse(content) failed, falling back to Shadowrocket parsing:",
      e,
    );
    return parseVmessShadowrocketParams(raw);
  }
}

function parseVmessQuantumult(content: string): IProxyVmessConfig {
  const partitions = content.split(",").map((p) => p.trim());
  const params: Record<string, string> = {};
  for (const part of partitions) {
    if (part.indexOf("=") !== -1) {
      const [key, val] = splitOnce(part, "=");
      params[key.trim()] = val?.trim() ?? "";
    }
  }

  const proxy: IProxyVmessConfig = {
    name: partitions[0].split("=")[0].trim(),
    type: "vmess",
    server: partitions[1],
    port: parseRequiredPort(partitions[2], "Invalid vmess uri: invalid port"),
    cipher: getCipher(getIfNotBlank(partitions[3], "auto")),
    uuid: partitions[4].match(/^"(.*)"$/)?.[1] || "",
    tls: params.obfs === "wss",
    udp: parseBool(params["udp-relay"]),
    tfo: parseBool(params["fast-open"]),
    "skip-cert-verify":
      params["tls-verification"] === undefined
        ? undefined
        : !parseBool(params["tls-verification"]),
  };

  if (isPresent(params.obfs)) {
    if (params.obfs === "ws" || params.obfs === "wss") {
      proxy.network = "ws";
      proxy["ws-opts"] = {
        path:
          (getIfNotBlank(params["obfs-path"]) || '"/"').match(
            /^"(.*)"$/,
          )?.[1] || "/",
        headers: {
          Host:
            params["obfs-header"]?.match(/Host:\s*([a-zA-Z0-9-.]*)/)?.[1] || "",
        },
      };
    } else {
      throw new Error(`Unsupported obfs: ${params.obfs}`);
    }
  }

  return proxy;
}

function URI_SS(line: string): IProxyShadowsocksConfig {
  const afterScheme = stripUriScheme(line, "ss", "Invalid ss uri");
  if (!afterScheme) {
    throw new Error("Invalid ss uri");
  }

  const [withoutHash, hashRaw] = splitOnce(afterScheme, "#");
  const nameFromHash = decodeAndTrim(hashRaw);

  const [mainRaw, queryRaw] = splitOnce(withoutHash, "?");
  const queryParams = parseQueryString(queryRaw);

  const main = mainRaw.includes("@")
    ? mainRaw
    : decodeBase64OrOriginal(mainRaw);
  const atIdx = main.lastIndexOf("@");
  if (atIdx === -1) {
    throw new Error("Invalid ss uri: missing '@'");
  }

  const userInfoStr = decodeBase64OrOriginal(main.slice(0, atIdx));
  const serverAndPortWithPath = main.slice(atIdx + 1);
  const serverAndPort = serverAndPortWithPath.split("/")[0];

  const portIdx = serverAndPort.lastIndexOf(":");
  if (portIdx === -1) {
    throw new Error("Invalid ss uri: missing port");
  }
  const server = serverAndPort.slice(0, portIdx);
  const portRaw = serverAndPort.slice(portIdx + 1);
  const port = parseRequiredPort(portRaw, "Invalid ss uri: invalid port");

  const userInfo = userInfoStr.match(/(^.*?):(.*$)/);

  const proxy: IProxyShadowsocksConfig = {
    name: nameFromHash ?? `SS ${server}:${port}`,
    type: "ss",
    server,
    port,
    cipher: getCipher(userInfo?.[1]),
    password: userInfo?.[2],
  };

  // plugin from `plugin=...`
  const pluginParam = queryParams.plugin;
  if (pluginParam) {
    const pluginParts = pluginParam.split(";");
    const pluginName = pluginParts[0];
    const pluginOptions: Record<string, any> = { plugin: pluginName };
    for (const raw of pluginParts.slice(1)) {
      if (!raw) continue;
      const [key, val] = splitOnce(raw, "=");
      if (!key) continue;
      pluginOptions[key] = val === undefined || val === "" ? true : val;
    }

    switch (pluginOptions.plugin) {
      case "obfs-local":
      case "simple-obfs":
        proxy.plugin = "obfs";
        proxy["plugin-opts"] = {
          mode: pluginOptions.obfs,
          host: getIfNotBlank(pluginOptions["obfs-host"]),
        };
        break;
      case "v2ray-plugin":
        proxy.plugin = "v2ray-plugin";
        proxy["plugin-opts"] = {
          mode: "websocket",
          host: getIfNotBlank(pluginOptions["obfs-host"] ?? pluginOptions.host),
          path: getIfNotBlank(pluginOptions.path),
          tls: getIfPresent(pluginOptions.tls),
        };
        break;
      default:
        throw new Error(`Unsupported plugin option: ${pluginOptions.plugin}`);
    }
  }

  // plugin from `v2ray-plugin=...` (base64 JSON)
  const v2rayPluginParam = queryParams["v2ray-plugin"];
  if (!proxy.plugin && v2rayPluginParam) {
    proxy.plugin = "v2ray-plugin";
    proxy["plugin-opts"] = JSON.parse(decodeBase64OrOriginal(v2rayPluginParam));
  }

  if (
    Object.prototype.hasOwnProperty.call(queryParams, "uot") &&
    parseBoolOrPresence(queryParams.uot)
  ) {
    proxy["udp-over-tcp"] = true;
  }
  if (
    Object.prototype.hasOwnProperty.call(queryParams, "tfo") &&
    parseBoolOrPresence(queryParams.tfo)
  ) {
    proxy.tfo = true;
  }

  return proxy;
}

function URI_SSR(line: string): IProxyshadowsocksRConfig {
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

function URI_VMESS(line: string): IProxyVmessConfig {
  const afterScheme = stripUriScheme(line, "vmess", "Invalid vmess uri");
  if (!afterScheme) {
    throw new Error("Invalid vmess uri");
  }
  const raw = afterScheme;
  const content = decodeBase64OrOriginal(raw);
  if (/=\s*vmess/.test(content)) {
    return parseVmessQuantumult(content);
  }

  const params = parseVmessParams(content, raw);
  const server = params.add;
  const port = parseRequiredPort(
    params.port,
    "Invalid vmess uri: invalid port",
  );
  const tlsValue = params.tls;
  const proxy: IProxyVmessConfig = {
    name:
      trimStr(params.ps) ??
      trimStr(params.remarks) ??
      trimStr(params.remark) ??
      `VMess ${server}:${port}`,
    type: "vmess",
    server,
    port,
    cipher: getCipher(getIfPresent(params.scy, "auto")),
    uuid: params.id,
    tls:
      tlsValue === "tls" ||
      tlsValue === true ||
      tlsValue === 1 ||
      tlsValue === "1" ||
      tlsValue === "true",
    "skip-cert-verify": isPresent(params.verify_cert)
      ? !parseBool(params.verify_cert.toString())
      : undefined,
  };

  proxy.alterId = parseInt(getIfPresent(params.aid ?? params.alterId, 0), 10);

  if (proxy.tls && params.sni) {
    proxy.servername = params.sni;
  }

  let httpupgrade = false;
  if (params.net === "ws" || params.obfs === "websocket") {
    proxy.network = "ws";
  } else if (
    ["http"].includes(params.net) ||
    ["http"].includes(params.obfs) ||
    ["http"].includes(params.type)
  ) {
    proxy.network = "http";
  } else if (["grpc"].includes(params.net)) {
    proxy.network = "grpc";
  } else if (params.net === "httpupgrade") {
    proxy.network = "ws";
    httpupgrade = true;
  } else if (params.net === "h2" || proxy.network === "h2") {
    proxy.network = "h2";
  }

  if (proxy.network) {
    let transportHost: any = params.host ?? params.obfsParam;
    if (typeof transportHost === "string") {
      try {
        const parsedObfs = JSON.parse(transportHost);
        const parsedHost = parsedObfs?.Host;
        if (parsedHost) {
          transportHost = parsedHost;
        }
      } catch (e) {
        console.warn("[URI_VMESS] transportHost JSON.parse failed:", e);
      }
    }

    const transportPath: any = params.path;
    const hostFirst = getIfNotBlank(firstString(transportHost));
    const pathFirst = getIfNotBlank(firstString(transportPath));

    switch (proxy.network) {
      case "grpc": {
        if (!hostFirst && !pathFirst) {
          delete proxy.network;
          break;
        }
        const serviceName = getIfNotBlank(pathFirst);
        if (serviceName) {
          proxy["grpc-opts"] = { "grpc-service-name": serviceName };
        }
        break;
      }
      case "h2": {
        if (!hostFirst && !pathFirst) {
          delete proxy.network;
          break;
        }
        const h2Opts: H2Options = {};
        if (hostFirst) h2Opts.host = hostFirst;
        if (pathFirst) h2Opts.path = pathFirst;
        if (Object.keys(h2Opts).length > 0) {
          proxy["h2-opts"] = h2Opts;
        }
        break;
      }
      case "http": {
        const hosts = Array.isArray(transportHost)
          ? transportHost
              .map((h: any) => String(h).trim())
              .filter((h: string) => h)
          : hostFirst
            ? [hostFirst]
            : undefined;

        let paths = Array.isArray(transportPath)
          ? transportPath
              .map((p: any) => String(p).trim())
              .filter((p: string) => p)
          : pathFirst
            ? [pathFirst]
            : [];

        if (paths.length === 0) paths = ["/"];

        const httpOpts: HttpOptions = { path: paths };
        if (hosts && hosts.length > 0) {
          httpOpts.headers = { Host: hosts };
        }
        proxy["http-opts"] = httpOpts;
        break;
      }
      case "ws": {
        if (!hostFirst && !pathFirst && !httpupgrade) {
          delete proxy.network;
          break;
        }
        const wsOpts: WsOptions = {
          path: pathFirst,
          headers: hostFirst ? { Host: hostFirst } : undefined,
        };
        if (httpupgrade) {
          wsOpts["v2ray-http-upgrade"] = true;
          wsOpts["v2ray-http-upgrade-fast-open"] = true;
        }
        proxy["ws-opts"] = wsOpts;
        break;
      }
      default:
        break;
    }

    if (proxy.tls && !proxy.servername && hostFirst) {
      proxy.servername = hostFirst;
    }
  }

  return proxy;
}

/**
 * VLess URL Decode.
 */
function URI_VLESS(line: string): IProxyVlessConfig {
  const afterScheme = stripUriScheme(line, "vless", "Invalid vless uri");
  if (!afterScheme) {
    throw new Error("Invalid vless uri");
  }

  let rest = afterScheme;
  let isShadowrocket = false;

  const parseVlessRest = (
    input: string,
  ): {
    uuidRaw: string;
    server: string;
    port: number;
    addons?: string;
    nameRaw?: string;
  } => {
    const parsed = parseUrlLike(input, {
      requireAuth: true,
      errorMessage: "Invalid vless uri",
    });
    if (!parsed.port) {
      throw new Error("Invalid vless uri: missing port");
    }
    const port = parseRequiredPort(
      parsed.port,
      "Invalid vless uri: invalid port",
    );
    return {
      uuidRaw: parsed.auth,
      server: parsed.host,
      port,
      addons: parsed.query,
      nameRaw: parsed.fragment,
    };
  };

  let parsed: ReturnType<typeof parseVlessRest>;
  try {
    parsed = parseVlessRest(rest);
  } catch {
    const shadowMatch = /^(.*?)(\?.*?$)/.exec(rest);
    if (!shadowMatch) {
      throw new Error("Invalid vless uri");
    }
    const [, base64Part, other] = shadowMatch;
    rest = `${decodeBase64OrOriginal(base64Part)}${other}`;
    parsed = parseVlessRest(rest);
    isShadowrocket = true;
  }

  const { uuidRaw, server, port, addons = "", nameRaw } = parsed;

  let uuid = uuidRaw;
  if (isShadowrocket) {
    uuid = uuid.replace(/^.*?:/g, "");
  }
  uuid = safeDecodeURIComponent(uuid) ?? uuid;

  const params = parseQueryStringNormalized(addons);
  const name =
    decodeAndTrim(nameRaw) ??
    trimStr(params.remarks) ??
    trimStr(params.remark) ??
    `VLESS ${server}:${port}`;

  const proxy: IProxyVlessConfig = {
    type: "vless",
    name,
    server,
    port,
    uuid,
  };

  proxy.tls = (params.security && params.security !== "none") || undefined;
  if (isShadowrocket && parseBool(params.tls) === true) {
    proxy.tls = true;
    params.security = params.security ?? "reality";
  }

  proxy.servername = params.sni || params.peer;
  proxy.flow = parseVlessFlow(params.flow);

  proxy["client-fingerprint"] = params.fp as ClientFingerprint;
  proxy.alpn = params.alpn ? params.alpn.split(",") : undefined;
  if (Object.prototype.hasOwnProperty.call(params, "allowInsecure")) {
    proxy["skip-cert-verify"] = parseBoolOrPresence(params.allowInsecure);
  }

  if (params.security === "reality") {
    const opts: IProxyVlessConfig["reality-opts"] = {};
    if (params.pbk) {
      opts["public-key"] = params.pbk;
    }
    if (params.sid) {
      opts["short-id"] = params.sid;
    }
    if (Object.keys(opts).length > 0) {
      proxy["reality-opts"] = opts;
    }
  }

  let httpupgrade = false;
  let network: NetworkType = "tcp";

  if (params.headerType === "http") {
    network = "http";
  } else {
    let type = params.type;
    if (type === "websocket") type = "ws";
    if (isShadowrocket && type === "sw") type = "ws";
    if (type === "httpupgrade") {
      network = "ws";
      httpupgrade = true;
    } else if (type && ["tcp", "ws", "http", "grpc", "h2"].includes(type)) {
      network = type as NetworkType;
    } else {
      network = "tcp";
    }

    if (params.type === "ws") {
      httpupgrade = true;
    }
  }

  proxy.network = network;

  if (proxy.network && !["tcp", "none"].includes(proxy.network)) {
    const host = params.host ?? params.obfsParam;
    const path = params.path;

    switch (proxy.network) {
      case "grpc":
        {
          const serviceName = getIfNotBlank(path);
          if (serviceName) {
            proxy["grpc-opts"] = { "grpc-service-name": serviceName };
          }
        }
        break;
      case "h2": {
        const h2Opts: H2Options = {};
        const hostVal = getIfNotBlank(host);
        const pathVal = getIfNotBlank(path);
        if (hostVal) h2Opts.host = hostVal;
        if (pathVal) h2Opts.path = pathVal;
        if (Object.keys(h2Opts).length > 0) {
          proxy["h2-opts"] = h2Opts;
        }
        break;
      }
      case "http": {
        const httpOpts: HttpOptions = {};
        const hostVal = getIfNotBlank(host);
        const pathVal = getIfNotBlank(path);
        if (pathVal) httpOpts.path = [pathVal];
        if (hostVal) httpOpts.headers = { Host: [hostVal] };
        if (Object.keys(httpOpts).length > 0) {
          proxy["http-opts"] = httpOpts;
        }
        break;
      }
      case "ws": {
        const wsOpts: WsOptions = {};
        if (host) {
          if (params.obfsParam) {
            try {
              const parsedHeaders = JSON.parse(host);
              wsOpts.headers = parsedHeaders;
            } catch (e) {
              console.warn("[URI_VLESS] host JSON.parse failed:", e);
              wsOpts.headers = { Host: host };
            }
          } else {
            wsOpts.headers = { Host: host };
          }
        }
        if (path) {
          wsOpts.path = path;
        }
        if (httpupgrade) {
          wsOpts["v2ray-http-upgrade"] = true;
          wsOpts["v2ray-http-upgrade-fast-open"] = true;
        }
        if (Object.keys(wsOpts).length > 0) {
          proxy["ws-opts"] = wsOpts;
        }
        break;
      }
      default:
        break;
    }
  }

  if (proxy.tls && !proxy.servername) {
    if (proxy.network === "ws") {
      proxy.servername = proxy["ws-opts"]?.headers?.Host;
    } else if (proxy.network === "http") {
      proxy.servername = proxy["http-opts"]?.headers?.Host?.[0];
    } else if (proxy.network === "h2") {
      proxy.servername = proxy["h2-opts"]?.host;
    }
  }

  return proxy;
}

function URI_Trojan(line: string): IProxyTrojanConfig {
  const afterScheme = stripUriScheme(line, "trojan", "Invalid trojan uri");
  if (!afterScheme) {
    throw new Error("Invalid trojan uri");
  }
  const {
    auth: passwordRaw,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, {
    requireAuth: true,
    errorMessage: "Invalid trojan uri",
  });
  const portNum = parsePortOrDefault(port, 443);
  const password = safeDecodeURIComponent(passwordRaw) ?? passwordRaw;
  const name = decodeAndTrim(nameRaw) ?? `Trojan ${server}:${portNum}`;
  const proxy: IProxyTrojanConfig = {
    type: "trojan",
    name,
    server,
    port: portNum,
    password,
  };

  const params = parseQueryStringNormalized(addons);

  const network = params.type;
  if (network && ["ws", "grpc", "h2", "tcp"].includes(network)) {
    proxy.network = network as NetworkType;
  }

  const host = getIfNotBlank(params.host);
  const path = getIfNotBlank(params.path);

  if (params.alpn) {
    proxy.alpn = params.alpn.split(",");
  }
  if (params.sni) {
    proxy.sni = params.sni;
  }
  if (Object.prototype.hasOwnProperty.call(params, "skip-cert-verify")) {
    proxy["skip-cert-verify"] = parseBoolOrPresence(params["skip-cert-verify"]);
  }

  proxy.fingerprint = params.fingerprint ?? params.fp;

  if (params.encryption) {
    const encryption = params.encryption.split(";");
    if (encryption.length === 3) {
      proxy["ss-opts"] = {
        enabled: true,
        method: encryption[1],
        password: encryption[2],
      };
    }
  }

  if (params["client-fingerprint"]) {
    proxy["client-fingerprint"] = params[
      "client-fingerprint"
    ] as ClientFingerprint;
  }

  if (proxy.network === "ws") {
    const wsOpts: WsOptions = {};
    if (host) wsOpts.headers = { Host: host };
    if (path) wsOpts.path = path;
    if (Object.keys(wsOpts).length > 0) {
      proxy["ws-opts"] = wsOpts;
    }
  } else if (proxy.network === "grpc") {
    const serviceName = getIfNotBlank(path);
    if (serviceName) {
      proxy["grpc-opts"] = { "grpc-service-name": serviceName };
    }
  }

  return proxy;
}

function URI_Hysteria2(line: string): IProxyHysteria2Config {
  const afterScheme = stripUriScheme(
    line,
    ["hysteria2", "hy2"],
    "Invalid hysteria2 uri",
  );
  if (!afterScheme) {
    throw new Error("Invalid hysteria2 uri");
  }
  const {
    auth: passwordRaw,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, {
    requireAuth: true,
    errorMessage: "Invalid hysteria2 uri",
  });
  const portNum = parsePortOrDefault(port, 443);
  const password = safeDecodeURIComponent(passwordRaw) ?? passwordRaw;

  const decodedName = decodeAndTrim(nameRaw);

  const name = decodedName ?? `Hysteria2 ${server}:${portNum}`;

  const proxy: IProxyHysteria2Config = {
    type: "hysteria2",
    name,
    server,
    port: portNum,
    password,
  };

  const params = parseQueryStringNormalized(addons);

  proxy.sni = params.sni;
  if (!proxy.sni && params.peer) {
    proxy.sni = params.peer;
  }
  if (params.obfs && params.obfs !== "none") {
    proxy.obfs = params.obfs;
  }

  proxy.ports = params.mport;
  proxy["obfs-password"] = params["obfs-password"];
  if (Object.prototype.hasOwnProperty.call(params, "insecure")) {
    proxy["skip-cert-verify"] = parseBoolOrPresence(params.insecure);
  }
  if (Object.prototype.hasOwnProperty.call(params, "fastopen")) {
    proxy.tfo = parseBoolOrPresence(params.fastopen);
  }
  proxy.fingerprint = params.pinSHA256;

  return proxy;
}

function URI_Hysteria(line: string): IProxyHysteriaConfig {
  const afterScheme = stripUriScheme(
    line,
    ["hysteria", "hy"],
    "Invalid hysteria uri",
  );
  if (!afterScheme) {
    throw new Error("Invalid hysteria uri");
  }
  const {
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, { errorMessage: "Invalid hysteria uri" });
  const portNum = parsePortOrDefault(port, 443);
  const name = decodeAndTrim(nameRaw) ?? `Hysteria ${server}:${portNum}`;

  const proxy: IProxyHysteriaConfig = {
    type: "hysteria",
    name,
    server,
    port: portNum,
  };

  const params = parseQueryStringNormalized(addons);

  for (const [key, value] of Object.entries(params)) {
    switch (key) {
      case "alpn":
        proxy.alpn = value ? value.split(",") : undefined;
        break;
      case "insecure":
        proxy["skip-cert-verify"] = parseBoolOrPresence(value);
        break;
      case "auth":
        if (value) proxy["auth-str"] = value;
        break;
      case "mport":
        if (value) proxy.ports = value;
        break;
      case "obfsParam":
        if (value) proxy.obfs = value;
        break;
      case "upmbps":
        if (value) proxy.up = value;
        break;
      case "downmbps":
        if (value) proxy.down = value;
        break;
      case "obfs":
        if (value !== undefined) proxy.obfs = value || "";
        break;
      case "fast-open":
        proxy["fast-open"] = parseBoolOrPresence(value);
        break;
      case "peer":
        if (!proxy.sni && value) proxy.sni = value;
        break;
      case "recv-window-conn":
        proxy["recv-window-conn"] = parseInteger(value);
        break;
      case "recv-window":
        proxy["recv-window"] = parseInteger(value);
        break;
      case "ca":
        if (value) proxy.ca = value;
        break;
      case "ca-str":
        if (value) proxy["ca-str"] = value;
        break;
      case "disable-mtu-discovery":
        proxy["disable-mtu-discovery"] = parseBoolOrPresence(value);
        break;
      case "fingerprint":
        if (value) proxy.fingerprint = value;
        break;
      case "protocol":
        if (value) proxy.protocol = value;
        break;
      case "sni":
        if (value) proxy.sni = value;
        break;
      default:
        break;
    }
  }

  if (!proxy.protocol) {
    proxy.protocol = "udp";
  }

  return proxy;
}

function URI_TUIC(line: string): IProxyTuicConfig {
  const afterScheme = stripUriScheme(line, "tuic", "Invalid tuic uri");
  if (!afterScheme) {
    throw new Error("Invalid tuic uri");
  }
  const {
    auth,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, {
    requireAuth: true,
    errorMessage: "Invalid tuic uri",
  });
  const [uuid, passwordRaw] = splitOnce(auth, ":");
  if (passwordRaw === undefined) {
    throw new Error("Invalid tuic uri");
  }

  const portNum = parsePortOrDefault(port, 443);
  const password = safeDecodeURIComponent(passwordRaw) ?? passwordRaw;
  const decodedName = decodeAndTrim(nameRaw);

  const name = decodedName ?? `TUIC ${server}:${portNum}`;

  const proxy: IProxyTuicConfig = {
    type: "tuic",
    name,
    server,
    port: portNum,
    password,
    uuid,
  };

  const params = parseQueryStringNormalized(addons);
  for (const [key, value] of Object.entries(params)) {
    switch (key) {
      case "token":
        proxy.token = value;
        break;
      case "ip":
        proxy.ip = value;
        break;
      case "heartbeat-interval":
        proxy["heartbeat-interval"] = parseInteger(value);
        break;
      case "alpn":
        proxy.alpn = value ? value.split(",") : undefined;
        break;
      case "disable-sni":
        proxy["disable-sni"] = parseBoolOrPresence(value);
        break;
      case "reduce-rtt":
        proxy["reduce-rtt"] = parseBoolOrPresence(value);
        break;
      case "request-timeout":
        proxy["request-timeout"] = parseInteger(value);
        break;
      case "udp-relay-mode":
        proxy["udp-relay-mode"] = value;
        break;
      case "congestion-controller":
        proxy["congestion-controller"] = value;
        break;
      case "max-udp-relay-packet-size":
        proxy["max-udp-relay-packet-size"] = parseInteger(value);
        break;
      case "fast-open":
        proxy["fast-open"] = parseBoolOrPresence(value);
        break;
      case "skip-cert-verify":
      case "allow-insecure":
        proxy["skip-cert-verify"] = parseBoolOrPresence(value);
        break;
      case "max-open-streams":
        proxy["max-open-streams"] = parseInteger(value);
        break;
      case "sni":
        proxy.sni = value;
        break;
      default:
        break;
    }
  }

  return proxy;
}

function URI_Wireguard(line: string): IProxyWireguardConfig {
  const afterScheme = stripUriScheme(
    line,
    ["wireguard", "wg"],
    "Invalid wireguard uri",
  );
  if (!afterScheme) {
    throw new Error("Invalid wireguard uri");
  }
  const {
    auth: privateKeyRaw,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, { errorMessage: "Invalid wireguard uri" });
  const portNum = parsePortOrDefault(port, 443);
  const privateKey = safeDecodeURIComponent(privateKeyRaw) ?? privateKeyRaw;
  const decodedName = decodeAndTrim(nameRaw);

  const name = decodedName ?? `WireGuard ${server}:${portNum}`;
  const proxy: IProxyWireguardConfig = {
    type: "wireguard",
    name,
    server,
    port: portNum,
    "private-key": privateKey,
    udp: true,
  };

  const params = parseQueryStringNormalized(addons);
  for (const [key, value] of Object.entries(params)) {
    switch (key) {
      case "address":
      case "ip":
        if (!value) break;
        value.split(",").forEach((i) => {
          const ip = i
            .trim()
            .replace(/\/\d+$/, "")
            .replace(/^\[/, "")
            .replace(/\]$/, "");
          if (isIPv4(ip)) {
            proxy.ip = ip;
          } else if (isIPv6(ip)) {
            proxy.ipv6 = ip;
          }
        });
        break;
      case "publickey":
      case "public-key":
        if (!value) break;
        proxy["public-key"] = value;
        break;
      case "allowed-ips":
        if (!value) break;
        proxy["allowed-ips"] = value.split(",");
        break;
      case "pre-shared-key":
        if (!value) break;
        proxy["pre-shared-key"] = value;
        break;
      case "reserved":
        {
          if (!value) break;
          const parsed = value
            .split(",")
            .map((i) => parseInteger(i.trim()))
            .filter((i): i is number => Number.isInteger(i));
          if (parsed.length === 3) {
            proxy["reserved"] = parsed;
          }
        }
        break;
      case "udp":
        proxy.udp = parseBoolOrPresence(value);
        break;
      case "mtu":
        proxy.mtu = parseInteger(value?.trim());
        break;
      case "dialer-proxy":
        proxy["dialer-proxy"] = value;
        break;
      case "remote-dns-resolve":
        proxy["remote-dns-resolve"] = parseBoolOrPresence(value);
        break;
      case "dns":
        if (!value) break;
        proxy.dns = value.split(",");
        break;
      default:
        break;
    }
  }

  return proxy;
}

function URI_HTTP(line: string): IProxyHttpConfig {
  const afterScheme = stripUriScheme(
    line,
    ["http", "https"],
    "Invalid http uri",
  );
  if (!afterScheme) {
    throw new Error("Invalid http uri");
  }
  const {
    auth: authRaw,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, { errorMessage: "Invalid http uri" });
  const portNum = parsePortOrDefault(port, 443);
  const auth = safeDecodeURIComponent(authRaw) ?? authRaw;
  const decodedName = decodeAndTrim(nameRaw);

  const name = decodedName ?? `HTTP ${server}:${portNum}`;
  const proxy: IProxyHttpConfig = {
    type: "http",
    name,
    server,
    port: portNum,
  };
  if (auth) {
    const [username, password] = splitOnce(auth, ":");
    proxy.username = username;
    proxy.password = password;
  }

  const params = parseQueryStringNormalized(addons);
  for (const [key, value] of Object.entries(params)) {
    switch (key) {
      case "tls":
        proxy.tls = parseBoolOrPresence(value);
        break;
      case "fingerprint":
        proxy.fingerprint = value;
        break;
      case "skip-cert-verify":
        proxy["skip-cert-verify"] = parseBoolOrPresence(value);
        break;
      case "ip-version":
        proxy["ip-version"] = parseIpVersion(value);
        break;
      default:
        break;
    }
  }

  return proxy;
}

function URI_SOCKS(line: string): IProxySocks5Config {
  const afterScheme = stripUriScheme(
    line,
    ["socks5", "socks"],
    "Invalid socks uri",
  );
  if (!afterScheme) {
    throw new Error("Invalid socks uri");
  }
  const {
    auth: authRaw,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, { errorMessage: "Invalid socks uri" });
  const portNum = parsePortOrDefault(port, 443);

  const auth = safeDecodeURIComponent(authRaw) ?? authRaw;
  const decodedName = decodeAndTrim(nameRaw);
  const name = decodedName ?? `SOCKS5 ${server}:${portNum}`;
  const proxy: IProxySocks5Config = {
    type: "socks5",
    name,
    server,
    port: portNum,
  };
  if (auth) {
    const [username, password] = splitOnce(auth, ":");
    proxy.username = username;
    proxy.password = password;
  }

  const params = parseQueryStringNormalized(addons);
  for (const [key, value] of Object.entries(params)) {
    switch (key) {
      case "tls":
        proxy.tls = parseBoolOrPresence(value);
        break;
      case "fingerprint":
        proxy.fingerprint = value;
        break;
      case "skip-cert-verify":
        proxy["skip-cert-verify"] = parseBoolOrPresence(value);
        break;
      case "udp":
        proxy.udp = parseBoolOrPresence(value);
        break;
      case "ip-version":
        proxy["ip-version"] = parseIpVersion(value);
        break;
      default:
        break;
    }
  }

  return proxy;
}
