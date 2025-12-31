import {
  decodeAndTrim,
  getIfNotBlank,
  parseBoolOrPresence,
  parsePortOrDefault,
  parseQueryStringNormalized,
  parseUrlLike,
  safeDecodeURIComponent,
  stripUriScheme,
} from "./helpers";

export function URI_Trojan(line: string): IProxyTrojanConfig {
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
