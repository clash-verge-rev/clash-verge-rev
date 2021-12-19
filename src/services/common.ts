import axios from "axios";
import { getAxios } from "./base";

/// Get Version
export async function getVersion() {
  return (await getAxios()).get("/version") as Promise<{
    premium: boolean;
    version: string;
  }>;
}

export interface ConfigType {
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

/// Get current base configs
export async function getClashConfig() {
  return (await getAxios()).get("/configs") as Promise<ConfigType>;
}

/// Update current configs
export async function updateConfigs(config: Partial<ConfigType>) {
  return (await getAxios()).patch("/configs", config);
}

interface RuleItem {
  type: string;
  payload: string;
  proxy: string;
}

/// Get current rules
export async function getRules() {
  return (await getAxios()).get("/rules") as Promise<RuleItem[]>;
}

/// Get logs stream
export async function getLogs(callback: (t: any) => void) {
  const source = axios.CancelToken.source();

  (await getAxios()).get("/logs", {
    cancelToken: source.token,
    onDownloadProgress: (progressEvent) => {
      const data = progressEvent.currentTarget.response || "";
      const lastData = data.slice(data.trim().lastIndexOf("\n") + 1);
      callback(JSON.parse(lastData));
    },
  });

  return source;
}
