import {
  decodeAndTrim,
  decodeBase64OrOriginal,
  getIfNotBlank,
  parseBool,
  parseBoolOrPresence,
  parseQueryStringNormalized,
  parseRequiredPort,
  parseUrlLike,
  parseVlessFlow,
  safeDecodeURIComponent,
  stripUriScheme,
  trimStr,
} from "./helpers";

/**
 * VLess URL Decode.
 */
export function URI_VLESS(line: string): IProxyVlessConfig {
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
  let network: NetworkType;

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
