export const HANDLE_FIELDS = [
  "port",
  "socks-port",
  "mixed-port",
  "allow-lan",
  "mode",
  "log-level",
  "ipv6",
  "secret",
  "external-controller",
];

export const DEFAULT_FIELDS = [
  "rules",
  "proxies",
  "proxy-groups",
  "proxy-providers",
  "rule-providers",
] as const;

export const OTHERS_FIELDS = [
  "tun",
  "dns",
  "ebpf",
  "hosts",
  "script",
  "profile",
  "payload",
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
  "sniffer", // meta
  "geodata-mode", // meta
  "tcp-concurrent", // meta
] as const;
