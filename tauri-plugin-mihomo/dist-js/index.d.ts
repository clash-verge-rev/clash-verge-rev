export interface MihomoVersion {
  meta: boolean;
  version: string;
}
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
export interface Proxies {
  proxies: Record<string, Proxy>;
}
export interface ProxyDelay {
  delay: number;
  message?: string;
}
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
export declare enum TunStack {
  Mixed = "Mixed",
  Gvisor = "gVisor",
  System = "System",
}
export declare enum ClashMode {
  Rule = "rule",
  Global = "global",
  Direct = "direct",
}
/**
 * 更新控制器地址
 * @param controller 控制器地址, 例如：127.0.0.1:9090
 */
export declare function updateController(controller: string): Promise<void>;
/**
 * 更新控制器的密钥
 * @param secret 控制器的密钥
 */
export declare function updateSecret(secret: string): Promise<void>;
/**
 * 获取Mihomo版本信息
 */
export declare function getVersion(): Promise<MihomoVersion>;
/**
 * 清除 FakeIP 的缓存
 */
export declare function cleanFakeIp(): Promise<void>;
/**
 * 获取所有连接信息
 * @returns 所有连接信息
 */
export declare function getConnections(): Promise<Connections>;
/**
 * 关闭所有连接
 */
export declare function closeAllConnections(): Promise<void>;
/**
 * 关闭指定连接
 * @param connectionId 连接 ID
 */
export declare function closeConnections(connectionId: string): Promise<void>;
/**
 * 获取所有代理组信息
 * @returns 所有代理组信息
 */
export declare function getGroups(): Promise<Groups>;
/**
 * 获取指定代理组信息
 * @param groupName 代理组名称
 * @returns 指定代理组信息
 */
export declare function getGroupByName(groupName: string): Promise<Proxy>;
/**
 * 获取指定代理组延迟
 *
 * 注：返回值中不包含超时的节点
 * @param groupName 代理组名称
 * @param testUrl 测试 url
 * @param timeout 超时时间（毫秒）
 * @returns 代理组里代理节点的延迟
 */
export declare function delayGroup(
  groupName: string,
  testUrl: string,
  timeout: number,
): Promise<MihomoGroupDelay>;
/**
 * 获取所有代理提供者信息
 * @returns 所有代理提供者信息
 */
export declare function getProxyProviders(): Promise<ProxyProviders>;
/**
 * 获取指定的代理提供者信息
 * @param providerName 代理提供者名称
 * @returns 代理提供者信息
 */
export declare function getProxyProviderByName(
  providerName: string,
): Promise<ProxyProvider>;
/**
 * 更新代理提供者信息
 * @param providerName 代理提供者名称
 */
export declare function updateProxyProvider(
  providerName: string,
): Promise<void>;
/**
 * 对指定的代理提供者进行健康检查
 * @param providerName 代理提供者名称
 */
export declare function healthcheckProxyProvider(
  providerName: string,
): Promise<void>;
/**
 * 对指定代理提供者下的指定节点（非代理组）进行健康检查, 并返回新的延迟信息
 * @param providerName 代理提供者名称
 * @param proxyName 代理节点名称 (非代理组)
 * @param testUrl 测试 url
 * @param timeout 超时时间
 * @returns 该代理节点的延迟
 */
export declare function healthcheckNodeInProvider(
  providerName: string,
  proxyName: string,
  testUrl: string,
  timeout: number,
): Promise<ProxyDelay>;
/**
 * 获取所有代理信息
 * @returns 所有代理信息
 */
export declare function getProxies(): Promise<Proxies>;
/**
 * 获取指定代理信息
 * @param proxyName 代理名称
 * @returns 代理信息
 */
export declare function getProxyByName(
  proxyName: string,
): Promise<Proxy | null>;
/**
 * 为指定代理选择节点
 *
 * 一般为指定代理组下使用指定的代理节点 【代理组/节点】
 * @param proxyName 代理组名称
 * @param node 代理节点
 */
export declare function selectNodeForProxy(
  proxyName: string,
  node: string,
): Promise<void>;
/**
 * 指定代理组下不再使用固定的代理节点
 *
 * 一般用于自动选择的代理组（例如：URLTest 类型的代理组）下的节点
 * @param groupName 代理组名称
 */
export declare function unfixedProxy(groupName: string): Promise<void>;
/**
 * 对指定代理进行延迟测试
 *
 * 一般用于代理节点的延迟测试，也可传代理组名称（只会测试代理组下选中的代理节点）
 * @param proxyName 代理节点名称
 * @param testUrl 测试 url
 * @param timeout 超时时间
 * @returns 该代理节点的延迟信息
 */
export declare function delayProxyByName(
  proxyName: string,
  testUrl: string,
  timeout: number,
): Promise<ProxyDelay>;
/**
 * 获取所有规则信息
 * @returns 所有规则信息
 */
export declare function getRules(): Promise<Rules>;
/**
 * 获取所有规则提供者信息
 * @returns 所有规则提供者信息
 */
export declare function getRuleProviders(): Promise<RuleProviders>;
/**
 * 更新规则提供者信息
 * @param providerName 规则提供者名称
 */
export declare function updateRuleProvider(providerName: string): Promise<void>;
/**
 * 获取基础配置
 * @returns 基础配置
 */
export declare function getBaseConfig(): Promise<BaseConfig>;
/**
 * 重新加载配置
 * @param force 强制更新
 * @param configPath 配置文件路径
 */
export declare function reloadConfig(
  force: boolean,
  configPath: string,
): Promise<void>;
/**
 * 更改基础配置
 * @param data 基础配置更改后的内容, 例如：{"tun": {"enabled": true}}
 */
export declare function patchBaseConfig(
  data: Record<string, any>,
): Promise<void>;
/**
 * 更新 Geo
 */
export declare function updateGeo(): Promise<void>;
/**
 * 重启核心
 */
export declare function restart(): Promise<void>;
/**
 * 升级核心
 */
export declare function upgradeCore(): Promise<void>;
/**
 * 更新 UI
 */
export declare function upgradeUi(): Promise<void>;
/**
 * 更新 Geo
 */
export declare function upgradeGeo(): Promise<void>;
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
export declare class MihomoWebSocket {
  id: number;
  private readonly listeners;
  private static instances;
  constructor(id: number, listeners: Set<(arg: Message) => void>);
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的流量监控
   * @returns WebSocket 实例
   */
  static connect_traffic(): Promise<MihomoWebSocket>;
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的内存监控
   * @returns WebSocket 实例
   */
  static connect_memory(): Promise<MihomoWebSocket>;
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的连接监控
   * @returns WebSocket 实例
   */
  static connect_connections(): Promise<MihomoWebSocket>;
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的日志监控
   * @returns WebSocket 实例
   */
  static connect_logs(
    level: "debug" | "info" | "warning" | "error" | "silent",
  ): Promise<MihomoWebSocket>;
  /**
   * 添加处理 WebSocket 连接后接受的数据的回调函数
   * @param cb 回调函数
   */
  addListener(cb: (arg: Message) => void): () => void;
  /**
   * 关闭 WebSocket 连接
   * @param forceTimeout 强制关闭 WebSocket 连接等待的时间，单位: 毫秒, 默认为 0
   */
  close(): Promise<void>;
  /**
   * 清理全部的 websocket 连接资源
   */
  static cleanupAll(): Promise<void>;
}
