export const HANDLE_FIELDS = [
  "mode",
  "port",
  "socks-port",
  "mixed-port",
  "allow-lan",
  "log-level",
  "ipv6",
  "secret",
  "external-controller",
];

export const DEFAULT_FIELDS = [
  "proxies",
  "proxy-groups",
  "proxy-providers",
  "rules",
  "rule-providers",
] as const;

export const OTHERS_FIELDS = [
  "dns",
  "tun",
  "ebpf",
  "hosts",
  "script",
  "profile",
  "payload",
  "tunnels",
  "auto-redir",
  "experimental",
  "interface-name",
  "routing-mark",
  "redir-port",
  "tproxy-port",
  "iptables",
  "external-ui",
  "bind-address",
  "authentication",
  "tls", // meta
  "sniffer", // meta
  "geox-url", // meta
  "listeners", // meta
  "sub-rules", // meta
  "geodata-mode", // meta
  "unified-delay", // meta
  "tcp-concurrent", // meta
  "enable-process", // meta
  "find-process-mode", // meta
  "external-controller-tls", // meta
  "global-client-fingerprint", // meta
] as const;
