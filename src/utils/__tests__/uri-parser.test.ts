import { Buffer } from "node:buffer";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import parseUri from "@/utils/uri-parser";

describe("parseUri", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    if (typeof globalThis.atob !== "function") {
      globalThis.atob = ((value: string) =>
        Buffer.from(value, "base64").toString(
          "binary",
        )) as typeof globalThis.atob;
    }
  });

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("parses shadowsocks URIs with plugin metadata", () => {
    const encoded = Buffer.from(
      "aes-128-gcm:secret-password@203.0.113.5:8388",
    ).toString("base64");

    const uri = `ss://${encoded}?plugin=obfs-local;obfs=http;obfs-host=example.com&uot=1#Sample%20Node`;
    const result = parseUri(uri);

    expect(result).toMatchObject({
      type: "ss",
      name: "Sample Node",
      server: "203.0.113.5",
      port: 8388,
      cipher: "aes-128-gcm",
      password: "secret-password",
      plugin: "obfs",
      "plugin-opts": {
        mode: "http",
        host: "example.com",
      },
      "udp-over-tcp": true,
    });
  });

  it("parses vmess base64 JSON payloads with websocket transport", () => {
    const payload = {
      v: "2",
      ps: "Demo Node",
      add: "example.com",
      port: "443",
      id: "12345678-1234-1234-1234-1234567890ab",
      aid: "0",
      net: "ws",
      host: "cdn.example.com",
      path: "/ws",
      tls: "tls",
      sni: "secure.example.com",
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");

    const result = parseUri(`vmess://${encoded}`);

    expect(result).toMatchObject({
      type: "vmess",
      name: "Demo Node",
      server: "example.com",
      port: 443,
      uuid: payload.id,
      alterId: 0,
      tls: true,
      network: "ws",
      cipher: "auto",
      servername: "secure.example.com",
      "ws-opts": {
        path: "/ws",
        headers: { Host: "cdn.example.com" },
      },
    });
  });

  it("throws for unsupported protocols", () => {
    expect(() => parseUri("foo://bar")).toThrow("Unknown uri type: foo");
  });

  it("parses socks5 URIs with credentials and transport flags", () => {
    const uri =
      "socks5://user:pass@example.net:1080?tls=1&fingerprint=edge&skip-cert-verify=0&udp=1&ip-version=ipv6-prefer#SOCKS%20Node";

    const result = parseUri(uri);

    expect(result).toMatchObject({
      type: "socks5",
      name: "SOCKS Node",
      server: "example.net",
      port: 1080,
      username: "user",
      password: "pass",
      tls: true,
      fingerprint: "edge",
      "skip-cert-verify": false,
      udp: true,
      "ip-version": "ipv6-prefer",
    });
  });

  it("parses http URIs with authentication and TLS metadata", () => {
    const uri =
      "http://user:pass@example.org:8080?tls=true&fingerprint=chrome&skip-cert-verify=1&ip-version=ipv4#HTTP%20Node";

    const result = parseUri(uri);

    expect(result).toMatchObject({
      type: "http",
      name: "HTTP Node",
      server: "example.org",
      port: 8080,
      username: "user",
      password: "pass",
      tls: true,
      fingerprint: "chrome",
      "skip-cert-verify": true,
      "ip-version": "ipv4",
    });
  });

  it("falls back to dual IP version when http URI specifies an unknown option", () => {
    const uri = "http://example.net?ip-version=future";

    const result = parseUri(uri) as IProxyHttpConfig;

    expect(result.type).toBe("http");
    expect(result.server).toBe("example.net");
    expect(result.port).toBe(443);
    expect(result["ip-version"]).toBe("dual");
    expect(result.name).toBe("undefined");
  });

  it("defaults socks5 port to 443 when missing in URI", () => {
    const result = parseUri("socks5://example.com") as IProxySocks5Config;

    expect(result.type).toBe("socks5");
    expect(result.server).toBe("example.com");
    expect(result.port).toBe(443);
    expect(result.name).toBe("undefined");
  });
});
