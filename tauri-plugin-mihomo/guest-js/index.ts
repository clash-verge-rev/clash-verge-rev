import { Channel, invoke } from "@tauri-apps/api/core";

export interface MihomoVersion {
  meta: boolean;
  version: string;
}

// connections
export interface Connections {
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
  type: string;
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
export interface Groups {
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
  type: ProxyType;
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

export enum ProxyType {
  Direct = "Direct",
  Reject = "Reject",
  RejectDrop = "RejectDrop",
  Compatible = "Compatible",
  Pass = "Pass",
  Dns = "Dns",
  Shadowsocks = "Shadowsocks",
  ShadowsocksR = "ShadowsocksR",
  Snell = "Snell",
  Socks5 = "Socks5",
  Http = "Http",
  Vmess = "Vmess",
  Vless = "Vless",
  Trojan = "Trojan",
  Hysteria = "Hysteria",
  Hysteria2 = "Hysteria2",
  WireGuard = "WireGuard",
  Tuic = "Tuic",
  Ssh = "Ssh",
  Mieru = "Mieru",
  AnyTLS = "AnyTLS",
  Relay = "Relay",
  Selector = "Selector",
  Fallback = "Fallback",
  URLTest = "URLTest",
  LoadBalance = "LoadBalance",
}

// providers
export interface ProxyProviders {
  providers: Record<string, ProxyProvider>;
}

export interface ProxyProvider {
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

export interface ProxyDelay {
  delay: number;
  message?: string;
}

// rules
export interface Rules {
  rules: Rule[];
}

export interface Rule {
  type: RuleType;
  payload: string;
  proxy: string;
  size: number;
}

export enum RuleType {
  Domain = "Domain",
  DomainSuffix = "DomainSuffix",
  DomainKeyword = "DomainKeyword",
  DomainRegex = "DomainRegex",
  GeoSite = "GeoSite",
  GeoIP = "GeoIP",
  SrcGeoIP = "SrcGeoIP",
  IPASN = "IPASN",
  SrcIPASN = "SrcIPASN",
  IPCIDR = "IPCIDR",
  SrcIPCIDR = "SrcIPCIDR",
  IPSuffix = "IPSuffix",
  SrcIPSuffix = "SrcIPSuffix",
  SrcPort = "SrcPort",
  DstPort = "DstPort",
  InPort = "InPort",
  InUser = "InUser",
  InName = "InName",
  InType = "InType",
  ProcessName = "ProcessName",
  ProcessPath = "ProcessPath",
  ProcessNameRegex = "ProcessNameRegex",
  ProcessPathRegex = "ProcessPathRegex",
  Match = "Match",
  RuleSet = "RuleSet",
  Network = "Network",
  DSCP = "DSCP",
  Uid = "Uid",
  SubRules = "SubRules",
  AND = "AND",
  OR = "OR",
  NOT = "NOT",
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

export interface Traffic {
  up: number;
  down: number;
}

export interface Memory {
  inuse: number;
  oslimit: number;
}

export interface Log {
  type: string;
  payload: string;
}

// ======================= functions =======================

/**
 * 更新控制器地址
 * @param controller 控制器地址, 例如：127.0.0.1:9090
 */
export async function updateController(controller: string): Promise<void> {
  const [host, portStr] = controller.trim().split(":");
  const port = parseInt(portStr);
  await invoke<void>("plugin:mihomo|update_controller", { host, port });
}

/**
 * 更新控制器的密钥
 * @param secret 控制器的密钥
 */
export async function updateSecret(secret: string): Promise<void> {
  await invoke<void>("plugin:mihomo|update_secret", { secret });
}

/**
 * 获取Mihomo版本信息
 */
export async function getVersion(): Promise<MihomoVersion> {
  return await invoke<MihomoVersion>("plugin:mihomo|get_version");
}

/**
 * 清除 FakeIP 的缓存
 */
export async function cleanFakeIp(): Promise<void> {
  await invoke<void>("plugin:mihomo|clean_fakeip");
}

// connections
/**
 * 获取所有连接信息
 * @returns 所有连接信息
 */
export async function getConnections(): Promise<Connections> {
  return await invoke<Connections>("plugin:mihomo|get_connections");
}

/**
 * 关闭所有连接
 */
export async function closeAllConnections(): Promise<void> {
  await invoke<void>("plugin:mihomo|close_all_connections");
}

/**
 * 关闭指定连接
 * @param connectionId 连接 ID
 */
export async function closeConnections(connectionId: string): Promise<void> {
  await invoke<void>("plugin:mihomo|close_connections", { connectionId });
}

// groups
/**
 * 获取所有代理组信息
 * @returns 所有代理组信息
 */
export async function getGroups(): Promise<Groups> {
  return await invoke<Groups>("plugin:mihomo|get_groups");
}

/**
 * 获取指定代理组信息
 * @param groupName 代理组名称
 * @returns 指定代理组信息
 */
export async function getGroupByName(groupName: string): Promise<Proxy> {
  return await invoke<Proxy>("plugin:mihomo|get_group_by_name", {
    groupName,
  });
}

/**
 * 获取指定代理组延迟
 *
 * 注：返回值中不包含超时的节点
 * @param groupName 代理组名称
 * @param testUrl 测试 url
 * @param timeout 超时时间（毫秒）
 * @returns 代理组里代理节点的延迟
 */
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
/**
 * 获取所有代理提供者信息
 * @returns 所有代理提供者信息
 */
export async function getProxyProviders(): Promise<ProxyProviders> {
  return await invoke<ProxyProviders>("plugin:mihomo|get_proxy_providers");
}

/**
 * 获取指定的代理提供者信息
 * @param providerName 代理提供者名称
 * @returns 代理提供者信息
 */
export async function getProxyProviderByName(
  providerName: string,
): Promise<ProxyProvider> {
  return await invoke<ProxyProvider>(
    "plugin:mihomo|get_proxy_provider_by_name",
    { providerName },
  );
}

/**
 * 更新代理提供者信息
 * @param providerName 代理提供者名称
 */
export async function updateProxyProvider(providerName: string): Promise<void> {
  await invoke<void>("plugin:mihomo|update_proxy_provider", {
    providerName,
  });
}

/**
 * 对指定的代理提供者进行健康检查
 * @param providerName 代理提供者名称
 */
export async function healthcheckProxyProvider(
  providerName: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|healthcheck_proxy_provider", {
    providerName,
  });
}

/**
 * 对指定代理提供者下的指定节点（非代理组）进行健康检查, 并返回新的延迟信息
 * @param providerName 代理提供者名称
 * @param proxyName 代理节点名称 (非代理组)
 * @param testUrl 测试 url
 * @param timeout 超时时间
 * @returns 该代理节点的延迟
 */
export async function healthcheckNodeInProvider(
  providerName: string,
  proxyName: string,
  testUrl: string,
  timeout: number,
): Promise<ProxyDelay> {
  return await invoke<ProxyDelay>(
    "plugin:mihomo|healthcheck_node_in_provider",
    {
      providerName,
      proxyName,
      testUrl,
      timeout,
    },
  );
}

// proxies
/**
 * 获取所有代理信息
 * @returns 所有代理信息
 */
export async function getProxies(): Promise<Proxies> {
  return await invoke<Proxies>("plugin:mihomo|get_proxies");
}

/**
 * 获取指定代理信息
 * @param proxyName 代理名称
 * @returns 代理信息
 */
export async function getProxyByName(proxyName: string): Promise<Proxy | null> {
  return await invoke<Proxy>("plugin:mihomo|get_proxy_by_name", {
    proxiesName: proxyName,
  });
}

/**
 * 为指定代理选择节点
 *
 * 一般为指定代理组下使用指定的代理节点 【代理组/节点】
 * @param proxyName 代理组名称
 * @param node 代理节点
 */
export async function selectNodeForProxy(
  proxyName: string,
  node: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|select_node_for_proxy", {
    proxyName,
    node,
  });
}

/**
 * 指定代理组下不再使用固定的代理节点
 *
 * 一般用于自动选择的代理组（例如：URLTest 类型的代理组）下的节点
 * @param groupName 代理组名称
 */
export async function unfixedProxy(groupName: string): Promise<void> {
  await invoke<void>("plugin:mihomo|unfixed_proxy", {
    groupName,
  });
}

/**
 * 对指定代理进行延迟测试
 *
 * 一般用于代理节点的延迟测试，也可传代理组名称（只会测试代理组下选中的代理节点）
 * @param proxyName 代理节点名称
 * @param testUrl 测试 url
 * @param timeout 超时时间
 * @returns 该代理节点的延迟信息
 */
export async function delayProxyByName(
  proxyName: string,
  testUrl: string,
  timeout: number,
): Promise<ProxyDelay> {
  return await invoke<ProxyDelay>("plugin:mihomo|delay_proxy_by_name", {
    proxyName,
    testUrl,
    timeout,
  });
}

// rules
/**
 * 获取所有规则信息
 * @returns 所有规则信息
 */
export async function getRules(): Promise<Rules> {
  return await invoke<Rules>("plugin:mihomo|get_rules");
}

/**
 * 获取所有规则提供者信息
 * @returns 所有规则提供者信息
 */
export async function getRuleProviders(): Promise<RuleProviders> {
  return await invoke<RuleProviders>("plugin:mihomo|get_rule_providers");
}

/**
 * 更新规则提供者信息
 * @param providerName 规则提供者名称
 */
export async function updateRuleProvider(providerName: string): Promise<void> {
  await invoke<void>("plugin:mihomo|update_rule_provider", {
    providerName,
  });
}

// runtime config
/**
 * 获取基础配置
 * @returns 基础配置
 */
export async function getBaseConfig(): Promise<BaseConfig> {
  return await invoke<BaseConfig>("plugin:mihomo|get_base_config");
}

/**
 * 重新加载配置
 * @param force 强制更新
 * @param configPath 配置文件路径
 */
export async function reloadConfig(
  force: boolean,
  configPath: string,
): Promise<void> {
  await invoke<void>("plugin:mihomo|reload_config", {
    force,
    configPath,
  });
}

/**
 * 更改基础配置
 * @param data 基础配置更改后的内容, 例如：{"tun": {"enabled": true}}
 */
export async function patchBaseConfig(
  data: Record<string, any>,
): Promise<void> {
  await invoke<void>("plugin:mihomo|patch_base_config", {
    data,
  });
}

/**
 * 更新 Geo
 */
export async function updateGeo(): Promise<void> {
  await invoke<void>("plugin:mihomo|update_geo");
}

/**
 * 重启核心
 */
export async function restart(): Promise<void> {
  await invoke<void>("plugin:mihomo|restart");
}

// upgrade
/**
 * 升级核心
 */
export async function upgradeCore(): Promise<void> {
  await invoke<void>("plugin:mihomo|upgrade_core");
}

/**
 * 更新 UI
 */
export async function upgradeUi(): Promise<void> {
  await invoke<void>("plugin:mihomo|upgrade_ui");
}

/**
 * 更新 Geo
 */
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

export class MihomoWebSocket {
  id: number;
  private readonly listeners: Set<(arg: Message) => void>;
  private static instances = new Set<MihomoWebSocket>();

  constructor(id: number, listeners: Set<(arg: Message) => void>) {
    this.id = id;
    this.listeners = listeners;
  }

  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的流量监控
   * @returns WebSocket 实例
   */
  static async connect_traffic(): Promise<MihomoWebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();
    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    const id = await invoke<number>("plugin:mihomo|ws_traffic", {
      onMessage,
    });
    const instance = new MihomoWebSocket(id, listeners);
    MihomoWebSocket.instances.add(instance);
    return instance;
  }

  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的内存监控
   * @returns WebSocket 实例
   */
  static async connect_memory(): Promise<MihomoWebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();
    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    const id = await invoke<number>("plugin:mihomo|ws_memory", {
      onMessage,
    });
    const instance = new MihomoWebSocket(id, listeners);
    MihomoWebSocket.instances.add(instance);
    return instance;
  }

  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的连接监控
   * @returns WebSocket 实例
   */
  static async connect_connections(): Promise<MihomoWebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();
    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    const id = await invoke<number>("plugin:mihomo|ws_connections", {
      onMessage,
    });
    const instance = new MihomoWebSocket(id, listeners);
    MihomoWebSocket.instances.add(instance);
    return instance;
  }

  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的日志监控
   * @returns WebSocket 实例
   */
  static async connect_logs(
    level: "debug" | "info" | "warning" | "error" | "silent",
  ): Promise<MihomoWebSocket> {
    const listeners: Set<(arg: Message) => void> = new Set();
    const onMessage = new Channel<Message>();
    onMessage.onmessage = (message: Message): void => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    const id = await invoke<number>("plugin:mihomo|ws_logs", {
      level,
      onMessage,
    });
    const instance = new MihomoWebSocket(id, listeners);
    MihomoWebSocket.instances.add(instance);
    return instance;
  }

  /**
   * 添加处理 WebSocket 连接后接受的数据的回调函数
   * @param cb 回调函数
   */
  addListener(cb: (arg: Message) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // /**
  //  * 发送消息到 WebSocket 连接
  //  * @param message 发送的消息
  //  */
  // async send(message: Message | string | number[]): Promise<void> {
  //   let m: Message;
  //   if (typeof message === "string") {
  //     m = { type: "Text", data: message };
  //   } else if (typeof message === "object" && "type" in message) {
  //     m = message;
  //   } else if (Array.isArray(message)) {
  //     m = { type: "Binary", data: message };
  //   } else {
  //     throw new Error(
  //       "invalid `message` type, expected a `{ type: string, data: any }` object, a string or a numeric array",
  //     );
  //   }
  //   await invoke("plugin:mihomo|ws_send", { id: this.id, message: m });
  // }

  /**
   * 关闭 WebSocket 连接
   * @param forceTimeout 强制关闭 WebSocket 连接等待的时间，单位: 毫秒, 默认为 0
   */
  async close(): Promise<void> {
    await invoke("plugin:mihomo|ws_disconnect", {
      id: this.id,
      forceTimeout: 0,
    });
    MihomoWebSocket.instances.delete(this);
  }

  /**
   * 清理全部的 websocket 连接资源
   */
  static async cleanupAll() {
    this.instances.forEach((instance) => instance.close());
    this.instances.clear();
    await invoke("plugin:mihomo|clear_all_ws_connection");
  }
}
