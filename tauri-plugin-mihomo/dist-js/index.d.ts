export interface MihomoVersion {
  meta: boolean;
  version: string;
}
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
export interface Proxies {
  proxies: Record<string, Proxy>;
}
export interface MihomoProxyDelay {
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
export declare function updateController(controller: string): Promise<void>;
export declare function updateSecret(secret: string): Promise<void>;
export declare function getVersion(): Promise<MihomoVersion>;
export declare function cleanFakeIp(): Promise<void>;
export declare function getConnections(): Promise<MihomoConnections>;
export declare function closeAllConnections(): Promise<void>;
export declare function closeConnections(connectionId: string): Promise<void>;
export declare function getGroups(): Promise<MihomoGroups | null>;
export declare function getGroupByName(
  groupName: string,
): Promise<Proxy | null>;
export declare function delayGroup(
  groupName: string,
  testUrl: string,
  timeout: number,
): Promise<MihomoGroupDelay>;
export declare function getProxiesProviders(): Promise<MihomoProviders>;
export declare function getProvidersProxyByName(
  providerName: string,
): Promise<ProxyProviders>;
export declare function updateProxiesProviders(
  providerName: string,
): Promise<void>;
export declare function healthcheckProviders(
  providersName: string,
): Promise<void>;
export declare function healthcheckProvidersProxies(
  providersName: string,
  proxiesName: string,
  testUrl: string,
  timeout: number,
): Promise<void>;
export declare function getProxies(): Promise<Proxies>;
export declare function getProxyByName(
  proxiesName: string,
): Promise<Proxy | null>;
export declare function selectNodeForProxy(
  proxyName: string,
  node: string,
): Promise<void>;
export declare function delayProxyByName(
  proxyName: string,
  testUrl: string,
  timeout: number,
): Promise<MihomoProxyDelay>;
export declare function getRules(): Promise<Rules>;
export declare function getRulesProviders(): Promise<RuleProviders>;
export declare function updateRulesProviders(
  providersName: string,
): Promise<void>;
export declare function getBaseConfig(): Promise<BaseConfig>;
export declare function reloadConfig(
  force: boolean,
  path: string,
): Promise<void>;
export declare function patchBaseConfig(
  data: Record<string, any>,
): Promise<void>;
export declare function updateGeo(): Promise<void>;
export declare function restart(): Promise<void>;
export declare function upgradeCore(): Promise<void>;
export declare function upgradeUi(): Promise<void>;
export declare function upgradeGeo(): Promise<void>;
