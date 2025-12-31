import {
  decodeAndTrim,
  parseBoolOrPresence,
  parsePortOrDefault,
  parseQueryStringNormalized,
  parseUrlLike,
  safeDecodeURIComponent,
  stripUriScheme,
} from "./helpers";

export function URI_Hysteria2(line: string): IProxyHysteria2Config {
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
