import {
  decodeBase64OrOriginal,
  firstString,
  getCipher,
  getIfNotBlank,
  getIfPresent,
  isPresent,
  parseBool,
  parseRequiredPort,
  safeDecodeURIComponent,
  splitOnce,
  stripUriScheme,
  trimStr,
} from "./helpers";

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

export function URI_VMESS(line: string): IProxyVmessConfig {
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
