/**
 * Some interface for clash api
 */
declare namespace ApiType {
  interface ConfigData {
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
  }

  interface RuleItem {
    type: string;
    payload: string;
    proxy: string;
  }

  interface ProxyItem {
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

  type ProxyGroupItem = Omit<ProxyItem, "all"> & {
    all: ProxyItem[];
  };

  interface ProviderItem {
    name: string;
    type: string;
    proxies: ProxyItem[];
    updatedAt: string;
    vehicleType: string;
  }

  interface TrafficItem {
    up: number;
    down: number;
  }

  interface LogItem {
    type: string;
    time?: string;
    payload: string;
  }

  interface ConnectionsItem {
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

  interface Connections {
    downloadTotal: number;
    uploadTotal: number;
    connections: ConnectionsItem[];
  }
}

/**
 * Some interface for command
 */
declare namespace CmdType {
  type ProfileType = "local" | "remote" | "merge" | "script";

  interface ClashInfo {
    status: string;
    port?: string;
    server?: string;
    secret?: string;
  }

  interface ProfileItem {
    uid: string;
    type?: ProfileType | string;
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
    option?: ProfileOption;
  }

  interface ProfileOption {
    user_agent?: string;
    with_proxy?: boolean;
    update_interval?: number;
  }

  interface ProfilesConfig {
    current?: string;
    chain?: string[];
    valid?: string[];
    items?: ProfileItem[];
  }

  interface VergeConfig {
    language?: string;
    clash_core?: string;
    theme_mode?: "light" | "dark" | "system";
    theme_blur?: boolean;
    traffic_graph?: boolean;
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
  }

  type ClashConfigValue = any;

  interface ProfileMerge {
    // clash config fields (default supports)
    rules?: ClashConfigValue;
    proxies?: ClashConfigValue;
    "proxy-groups"?: ClashConfigValue;
    "proxy-providers"?: ClashConfigValue;
    "rule-providers"?: ClashConfigValue;
    // clash config fields (use flag)
    tun?: ClashConfigValue;
    dns?: ClashConfigValue;
    hosts?: ClashConfigValue;
    script?: ClashConfigValue;
    profile?: ClashConfigValue;
    payload?: ClashConfigValue;
    "interface-name"?: ClashConfigValue;
    "routing-mark"?: ClashConfigValue;
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
  type ProfileData = Partial<{
    rules: any[];
    proxies: any[];
    "proxy-groups": any[];
    "proxy-providers": any[];
    "rule-providers": any[];

    [k: string]: any;
  }>;

  interface ChainItem {
    item: ProfileItem;
    merge?: ProfileMerge;
    script?: string;
  }

  interface EnhancedPayload {
    chain: ChainItem[];
    valid: string[];
    current: ProfileData;
    callback: string;
  }

  interface EnhancedResult {
    data: ProfileData;
    status: string;
    error?: string;
  }
}
