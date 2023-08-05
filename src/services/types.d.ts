type Platform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

/**
 * defines in `vite.config.ts`
 */
declare const WIN_PORTABLE: boolean;
declare const OS_PLATFORM: Platform;

/**
 * Some interface for clash api
 */
interface IConfigData {
  port: number;
  mode: string;
  ipv6: boolean;
  "socket-port": number;
  "allow-lan": boolean;
  "log-level": string;
  "mixed-port": number;
  "redir-port": number;
  "socks-port": number;
  "tproxy-port": number;
  "external-controller": string;
  secret: string;
}

interface IRuleItem {
  type: string;
  payload: string;
  proxy: string;
}

interface IProxyItem {
  name: string;
  type: string;
  udp: boolean;
  history: {
    time: string;
    delay: number;
  }[];
  all?: string[];
  now?: string;
  provider?: string; // 记录是否来自provider
}

type IProxyGroupItem = Omit<IProxyItem, "all"> & {
  all: IProxyItem[];
};

interface IProviderItem {
  name: string;
  type: string;
  proxies: IProxyItem[];
  updatedAt: string;
  vehicleType: string;
}

interface ITrafficItem {
  up: number;
  down: number;
}

interface ILogItem {
  type: string;
  time?: string;
  payload: string;
}

interface IConnectionsItem {
  id: string;
  metadata: {
    network: string;
    type: string;
    host: string;
    sourceIP: string;
    sourcePort: string;
    destinationPort: string;
    destinationIP?: string;
    process?: string;
    processPath?: string;
  };
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  curUpload?: number; // upload speed, calculate at runtime
  curDownload?: number; // download speed, calculate at runtime
}

interface IConnections {
  downloadTotal: number;
  uploadTotal: number;
  connections: IConnectionsItem[];
}

/**
 * Some interface for command
 */

interface IClashInfo {
  // status: string;
  port?: number; // clash mixed port
  server?: string; // external-controller
  secret?: string;
}

interface IProfileItem {
  uid: string;
  type?: "local" | "remote" | "merge" | "script";
  name?: string;
  desc?: string;
  file?: string;
  url?: string;
  updated?: number;
  selected?: {
    name?: string;
    now?: string;
  }[];
  extra?: {
    upload: number;
    download: number;
    total: number;
    expire: number;
  };
  option?: IProfileOption;
}

interface IProfileOption {
  user_agent?: string;
  with_proxy?: boolean;
  self_proxy?: boolean;
  update_interval?: number;
}

interface IProfilesConfig {
  current?: string;
  chain?: string[];
  valid?: string[];
  items?: IProfileItem[];
}

interface IVergeConfig {
  app_log_level?: "trace" | "debug" | "info" | "warn" | "error" | string;
  language?: string;
  clash_core?: string;
  theme_mode?: "light" | "dark" | "system";
  theme_blur?: boolean;
  traffic_graph?: boolean;
  enable_memory_usage?: boolean;
  enable_tun_mode?: boolean;
  enable_auto_launch?: boolean;
  enable_service_mode?: boolean;
  enable_silent_start?: boolean;
  enable_system_proxy?: boolean;
  enable_proxy_guard?: boolean;
  proxy_guard_duration?: number;
  system_proxy_bypass?: string;
  web_ui_list?: string[];
  hotkeys?: string[];
  theme_setting?: {
    primary_color?: string;
    secondary_color?: string;
    primary_text?: string;
    secondary_text?: string;
    info_color?: string;
    error_color?: string;
    warning_color?: string;
    success_color?: string;
    font_family?: string;
    css_injection?: string;
  };
  auto_close_connection?: boolean;
  default_latency_test?: string;
  enable_clash_fields?: boolean;
  enable_builtin_enhanced?: boolean;
  proxy_layout_column?: number;
}

type IClashConfigValue = any;

interface IProfileMerge {
  // clash config fields (default supports)
  rules?: IClashConfigValue;
  proxies?: IClashConfigValue;
  "proxy-groups"?: IClashConfigValue;
  "proxy-providers"?: IClashConfigValue;
  "rule-providers"?: IClashConfigValue;
  // clash config fields (use flag)
  tun?: IClashConfigValue;
  dns?: IClashConfigValue;
  hosts?: IClashConfigValue;
  script?: IClashConfigValue;
  profile?: IClashConfigValue;
  payload?: IClashConfigValue;
  "interface-name"?: IClashConfigValue;
  "routing-mark"?: IClashConfigValue;
  // functional fields
  use?: string[];
  "prepend-rules"?: any[];
  "append-rules"?: any[];
  "prepend-proxies"?: any[];
  "append-proxies"?: any[];
  "prepend-proxy-groups"?: any[];
  "append-proxy-groups"?: any[];
  // fix
  ebpf?: any;
  experimental?: any;
  iptables?: any;
  sniffer?: any;
  authentication?: any;
  "bind-address"?: any;
  "external-ui"?: any;
  "auto-redir"?: any;
  "socks-port"?: any;
  "redir-port"?: any;
  "tproxy-port"?: any;
  "geodata-mode"?: any;
  "tcp-concurrent"?: any;
}

// partial of the clash config
type IProfileData = Partial<{
  rules: any[];
  proxies: any[];
  "proxy-groups": any[];
  "proxy-providers": any[];
  "rule-providers": any[];

  [k: string]: any;
}>;

interface IChainItem {
  item: IProfileItem;
  merge?: IProfileMerge;
  script?: string;
}

interface IEnhancedPayload {
  chain: IChainItem[];
  valid: string[];
  current: IProfileData;
  callback: string;
}

interface IEnhancedResult {
  data: IProfileData;
  status: string;
  error?: string;
}
