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

export function URI_HTTP(line: string): IProxyHttpConfig {
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
