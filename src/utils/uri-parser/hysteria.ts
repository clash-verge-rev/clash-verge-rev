import {
  decodeAndTrim,
  parseBoolOrPresence,
  parseInteger,
  parsePortOrDefault,
  parseQueryStringNormalized,
  parseUrlLike,
  stripUriScheme,
} from "./helpers";

export function URI_Hysteria(line: string): IProxyHysteriaConfig {
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
