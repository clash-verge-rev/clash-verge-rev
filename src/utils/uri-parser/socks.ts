import {
  decodeAndTrim,
  parseBoolOrPresence,
  parseIpVersion,
  parsePortOrDefault,
  parseQueryStringNormalized,
  parseUrlLike,
  safeDecodeURIComponent,
  splitOnce,
  stripUriScheme,
} from "./helpers";

export function URI_SOCKS(line: string): IProxySocks5Config {
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
