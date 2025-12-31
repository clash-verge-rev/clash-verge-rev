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

export function URI_AnyTLS(line: string): IProxyAnyTLSConfig {
  const afterScheme = stripUriScheme(line, "anytls", "Invalid anytls uri");
  if (!afterScheme) {
    throw new Error("Invalid anytls uri");
  }
  const {
    auth: authRaw,
    host: server,
    port,
    query: addons,
    fragment: nameRaw,
  } = parseUrlLike(afterScheme, {
    errorMessage: "Invalid anytls uri",
  });
  if (!server) {
    throw new Error("Invalid anytls uri");
  }
  const portNum = parsePortOrDefault(port, 443);
  const auth = safeDecodeURIComponent(authRaw) ?? authRaw;
  const decodedName = decodeAndTrim(nameRaw);
  const name = decodedName ?? `AnyTLS ${server}:${portNum}`;
  const proxy: IProxyAnyTLSConfig = {
    type: "anytls",
    name,
    server,
    port: portNum,
    udp: true,
  };

  if (auth) {
    const [username, password] = splitOnce(auth, ":");
    proxy.password = password ?? username;
  }

  const params = parseQueryStringNormalized(addons);
  if (params.sni) {
    proxy.sni = params.sni;
  }
  if (params.alpn) {
    const alpn = params.alpn
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (alpn.length > 0) {
      proxy.alpn = alpn;
    }
  }

  const fingerprint = params.fingerprint ?? params.hpkp;
  if (fingerprint) {
    proxy.fingerprint = fingerprint;
  }
  const clientFingerprint = params["client-fingerprint"] ?? params.fp;
  if (clientFingerprint) {
    proxy["client-fingerprint"] = clientFingerprint as ClientFingerprint;
  }

  if (Object.prototype.hasOwnProperty.call(params, "skip-cert-verify")) {
    proxy["skip-cert-verify"] = parseBoolOrPresence(params["skip-cert-verify"]);
  } else if (Object.prototype.hasOwnProperty.call(params, "insecure")) {
    proxy["skip-cert-verify"] = parseBoolOrPresence(params.insecure);
  }

  if (Object.prototype.hasOwnProperty.call(params, "udp")) {
    proxy.udp = parseBoolOrPresence(params.udp);
  }

  const idleCheck = parseInteger(params["idle-session-check-interval"]);
  if (idleCheck !== undefined) {
    proxy["idle-session-check-interval"] = idleCheck;
  }
  const idleTimeout = parseInteger(params["idle-session-timeout"]);
  if (idleTimeout !== undefined) {
    proxy["idle-session-timeout"] = idleTimeout;
  }
  const minIdle = parseInteger(params["min-idle-session"]);
  if (minIdle !== undefined) {
    proxy["min-idle-session"] = minIdle;
  }

  return proxy;
}
