/**
 * Some interface for clash api
 */
export namespace ApiType {
  export interface ConfigData {
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

  export interface RuleItem {
    type: string;
    payload: string;
    proxy: string;
  }

  export interface ProxyItem {
    name: string;
    type: string;
    udp: boolean;
    history: {
      time: string;
      delay: number;
    }[];
    all?: string[];
    now?: string;
  }

  export type ProxyGroupItem = Omit<ProxyItem, "all"> & {
    all: ProxyItem[];
  };

  export interface TrafficItem {
    up: number;
    down: number;
  }

  export interface LogItem {
    type: string;
    time?: string;
    payload: string;
  }

  export interface ConnectionsItem {
    id: string;
    metadata: {
      network: string;
      type: string;
      host: string;
      sourceIP: string;
      sourcePort: string;
      destinationPort: string;
      destinationIP?: string;
    };
    upload: number;
    download: number;
    start: string;
    chains: string[];
    rule: string;
    rulePayload: string;
  }

  export interface Connections {
    downloadTotal: number;
    uploadTotal: number;
    connections: ConnectionsItem[];
  }
}

/**
 * Some interface for command
 */
export namespace CmdType {
  export interface ClashInfo {
    status: string;
    port?: string;
    server?: string;
    secret?: string;
  }

  export interface ProfileItem {
    name?: string;
    desc?: string;
    file?: string;
    mode?: string;
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
  }

  export interface ProfilesConfig {
    current?: number;
    items?: ProfileItem[];
  }

  export interface VergeConfig {
    theme_mode?: "light" | "dark";
    theme_blur?: boolean;
    enable_auto_launch?: boolean;
    enable_system_proxy?: boolean;
  }
}
