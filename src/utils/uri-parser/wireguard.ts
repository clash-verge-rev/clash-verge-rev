import {
  decodeAndTrim,
  isIPv4,
  isIPv6,
  parseBoolOrPresence,
  parseInteger,
  parsePortOrDefault,
  parseQueryStringNormalized,
  parseUrlLike,
  safeDecodeURIComponent,
  stripUriScheme,
} from "./helpers";

export function URI_Wireguard(line: string): IProxyWireguardConfig {
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
