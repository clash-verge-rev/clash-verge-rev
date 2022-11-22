function main(params) {
  if (Array.isArray(params.proxies)) {
    params.proxies.forEach((p, i) => {
      if (p.type === "hysteria" && typeof p.alpn === "string") {
        params.proxies[i].alpn = [p.alpn];
      }
    });
  }
  return params;
}
