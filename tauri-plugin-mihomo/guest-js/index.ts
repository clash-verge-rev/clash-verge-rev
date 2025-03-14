import { Channel, invoke } from "@tauri-apps/api/core";

export interface MihomoVersion {
  meta: boolean;
  version: string;
}

// connections
export interface MihomoConnections {
  downloadTotal: number;
  uploadTotal: number;
  connections: Connection[];
  memory: number;
}

export interface Connection {
  id: string;
  metadata: ConnectionMetaData;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
}

export interface ConnectionMetaData {
  network: string;
  connectionType: string;
  sourceIp: string;
  destinationIp: string;
  sourceGeoIp: string | null;
  destinationGeoIp: string | null;
  sourceIpAsn: string;
  destinationIpAsn: string | null;
  sourcePort: number;
  destinationPort: number;
  inboundIp: string;
  inboundPort: number;
  inboundName: string;
  inboundUser: string;
  host: string;
  dnsMode: string;
  uid: number;
  process: string;
  processPath: string;
  specialProxy: string;
  specialRules: string;
  remoteDestination: string;
  dscp: number;
  sniffHost: string;
}

// groups
export interface MihomoGroups {
  proxies: Proxy[];
}

export interface Proxy {
  id: string;
  alive: boolean;
  all: string[];
  expectedStatus: string;
  extra: Record<string, Extra>;
  fixed: string;
  hidden: boolean;
  history: DelayHistory[];
  icon: string;
  name: string;
  now: string;
  testUrl: string;
  tfo: boolean;
  type: string;
  udp: boolean;
  xudp: boolean;
}

export interface Extra {
  alive: boolean;
  history: DelayHistory[];
}

export interface DelayHistory {
  time: string;
  delay: number;
}

// providers
export interface MihomoProviders {
  providers: Record<string, ProxyProviders>;
}

export interface ProxyProviders {
  expectedStatus: string;
  name: string;
  proxies: Proxy[];
  testUrl: string;
  type: string;
  vehicleType: string;
  subscriptionInfo: SubscriptionInfo;
  updatedAt: string;
}

export interface SubscriptionInfo {
  upload: number;
  download: number;
  total: number;
  expire: number;
}

export type MihomoGroupDelay = Record<string, number>;

// proxies
export interface Proxies {
  proxies: Record<string, Proxy>;
}

export interface MihomoProxyDelay {
  delay: number;
  message?: string;
}

// rules
export interface Rules {
  rules: Rule[];
}

export interface Rule {
  type: string;
  payload: string;
  proxy: string;
  size: number;
}

export interface RuleProviders {
  providers: Record<string, RuleProvider>;
}

export interface RuleProvider {
  behavior: string;
  format: string;
  name: string;
  ruleCount: number;
  type: string;
  updatedAt: string;
  vehicleType: string;
}

export interface BaseConfig {
  port: number;
  mixedPort: number;
  socksPort: number;
  redirPort: number;
  tproxyPort: number;
  tun: TunConfig;
  lanAllowedIps: string[];
  lanDisallowedIps: string[];
  allow_lan: boolean;
  bindAddress: string;
  inboundTfo: boolean;
  inboundMptcp: boolean;
  mode: ClashMode;
  unifiedDelay: boolean;
  logLevel: string;
  ipv6: boolean;
  interfaceName: string;
  routingMark: number;
  geoxUrl: Record<string, string>;
  geoAutoUpdate: boolean;
  geoAutoUpdateInterval: number;
  geodataMode: boolean;
  geodataLoader: string;
  geositeMatcher: string;
  tcpConcurrent: boolean;
  findProcessMode: string;
  sniffing: boolean;
  globalClientFingerprint: string;
  globalUa: string;
}

export interface TunConfig {
  enable: boolean;
  device: string;
  stack: TunStack;
  dnsHijack: string[];
  autoRoute: boolean;
  autoDetectInterface: boolean;
  mtu: number;
  gsoMaxSize: number | null;
  inet4Address: string[];
  fileDescriptor: number;
}

export enum TunStack {
  Mixed = "Mixed",
  Gvisor = "gVisor",
  System = "System",
}

export enum ClashMode {
  Rule = "rule",
  Global = "global",
  Direct = "direct",
}

// ======================= functions =======================
export async function updateController(controller: string): Promise<void> {
  const [host, portStr] = controller.trim().split(":");
  const port = parseInt(portStr);
  await invoke<void>("plugin:mihomo|update_controller", { host, port });
}

export async function updateSecret(secret: string): Promise<void> {
  await invoke<void>("plugin:mihomo|update_secret", { secret });
}

export async function getVersion(): Promise<MihomoVersion> {
  return await invoke<MihomoVersion>("plugin:mihomo|get_version");
}

export async function cleanFakeIp(): Promise<void> {
  await invoke<void>("plugin:mihomo|clean_fakeip");
}

// connections
export async function getConnections(): Promise<MihomoConnections> {
  return await invoke<MihomoConnections>("plugin:mihomo|get_connections");
}

export async function closeAllConnections(): Promise<void> {
  await invoke<void>("plugin:mihomo|close_all_connections");
}

export async function closeConnections(connectionId: string): Promise<void> {
  await invoke<void>("plugin:mihomo|close_connections", { connectionId });
}

// groups
export async function getGroups(): Promise<MihomoGroups | null> {
  return await invoke<MihomoGroups>("plugin:mihomo|get_groups");
}

export async function getGroupByName(groupName: string): Promise<Proxy | null> {
  return await invoke<Proxy>("plugin:mihomo|get_group_by_name", {
    groupName,
  });
}

export async function delayGroup(
  groupName: string,
  testUrl: string,
  timeout: number,
): Promise<MihomoGroupDelay> {
  return await invoke<MihomoGroupDelay>("plugin:mihomo|delay_group", {
    groupName,
    testUrl,
    timeout,
  });
}

// providers
export async function getProxiesProviders(): Promise<MihomoProviders> {
  return await invoke<MihomoProviders>("plugin:mihomo|get_proxies_providers");
}

export async function getProvidersProxyByName(
  providerName: string,
): Promise<ProxyProviders> {
  return await invoke<ProxyProviders>(
    "plugin:mihomo|get_providers_proxy_by_name",
    { providerName },
  );
}

export async function updateProxiesProviders(
  providerName: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|update_proxies_providers", {
    providerName,
  });
}

export async function healthcheckProviders(
  providersName: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|healthcheck_providers", { providersName });
}

export async function healthcheckProvidersProxies(
  providersName: string,
  proxiesName: string,
  testUrl: string,
  timeout: number,
): Promise<void> {
  await invoke<void>("plugin:mihomo|healthcheck_providers_proxies", {
    providersName,
    proxiesName,
    testUrl,
    timeout,
  });
}

// proxies
export async function getProxies(): Promise<Proxies> {
  return await invoke<Proxies>("plugin:mihomo|get_proxies");
}

export async function getProxyByName(
  proxiesName: string,
): Promise<Proxy | null> {
  return await invoke<Proxy>("plugin:mihomo|get_proxy_by_name", {
    proxiesName,
  });
}

export async function selectNodeForProxy(
  proxyName: string,
  node: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|select_node_for_proxy", {
    proxyName,
    node,
  });
}

export async function delayProxyByName(
  proxyName: string,
  testUrl: string,
  timeout: number,
): Promise<MihomoProxyDelay> {
  return await invoke<MihomoProxyDelay>("plugin:mihomo|delay_proxy_by_name", {
    proxyName,
    testUrl,
    timeout,
  });
}

// rules
export async function getRules(): Promise<Rules> {
  return await invoke<Rules>("plugin:mihomo|get_rules");
}

export async function getRulesProviders(): Promise<RuleProviders> {
  return await invoke<RuleProviders>("plugin:mihomo|get_rules_providers");
}

export async function updateRulesProviders(
  providersName: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|update_rules_providers", {
    providersName,
  });
}

// runtime config
export async function getBaseConfig(): Promise<BaseConfig> {
  return await invoke<BaseConfig>("plugin:mihomo|get_base_config");
}

export async function reloadConfig(
  force: boolean,
  path: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|reload_config", {
    force,
    path,
  });
}

export async function patchBaseConfig(
  data: Record<string, any>,
): Promise<void> {
  await invoke<void>("plugin:mihomo|patch_base_config", {
    data,
  });
}

export async function updateGeo(): Promise<void> {
  await invoke<void>("plugin:mihomo|update_geo");
}

export async function restart(): Promise<void> {
  await invoke<void>("plugin:mihomo|restart");
}

// upgrade
export async function upgradeCore(): Promise<void> {
  await invoke<void>("plugin:mihomo|upgrade_core");
}

export async function upgradeUi(): Promise<void> {
  await invoke<void>("plugin:mihomo|upgrade_ui");
}

export async function upgradeGeo(): Promise<void> {
  await invoke<void>("plugin:mihomo|upgrade_geo");
}

export interface MessageKind<T, D> {
  type: T;
  data: D;
}

export interface CloseFrame {
  code: number;
  reason: string;
}

export type Message =
  | MessageKind<"Text", string>
  | MessageKind<"Binary", number[]>
  | MessageKind<"Ping", number[]>
  | MessageKind<"Pong", number[]>
  | MessageKind<"Close", CloseFrame | null>;

export class WebSocket {
  id: number;
  private readonly listeners: Set<(arg: Message) => void>;

  constructor(id: number, listeners: Set<(arg: Message) => void>) {
    this.id = id;
    this.listeners = listeners;
  }

  static async connect(url: string): Promise<WebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();

    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };

    return await invoke<number>("plugin:mihomo|connect", {
      url,
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }

  static async connect_traffic(): Promise<WebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();

    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };

    return await invoke<number>("plugin:mihomo|ws_traffic", {
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }

  static async connect_memory(): Promise<WebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();

    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };

    return await invoke<number>("plugin:mihomo|ws_memory", {
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }

  static async connect_connections(): Promise<WebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();

    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };

    return await invoke<number>("plugin:mihomo|ws_connections", {
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }

  static async connect_logs(
    level: "debug" | "info" | "warn" | "error",
  ): Promise<WebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();

    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };

    return await invoke<number>("plugin:mihomo|ws_logs", {
      level,
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }

  addListener(cb: (arg: Message) => void): () => void {
    this.listeners.add(cb);

    return () => {
      this.listeners.delete(cb);
    };
  }

  async send(message: Message | string | number[]): Promise<void> {
    let m: Message;
    if (typeof message === "string") {
      m = { type: "Text", data: message };
    } else if (typeof message === "object" && "type" in message) {
      m = message;
    } else if (Array.isArray(message)) {
      m = { type: "Binary", data: message };
    } else {
      throw new Error(
        "invalid `message` type, expected a `{ type: string, data: any }` object, a string or a numeric array",
      );
    }
    await invoke("plugin:mihomo|send", { id: this.id, message: m });
  }

  async disconnect(): Promise<void> {
    await invoke("plugin:mihomo|disconnect", { id: this.id });
  }
}
