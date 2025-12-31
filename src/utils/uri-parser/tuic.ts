import {
  decodeAndTrim,
  parseBoolOrPresence,
  parseInteger,
  parsePortOrDefault,
  parseQueryStringNormalized,
  parseUrlLike,
  safeDecodeURIComponent,
  splitOnce,
  stripUriScheme,
} from "./helpers";

export function URI_TUIC(line: string): IProxyTuicConfig {
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
