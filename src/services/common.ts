import axios from "axios";
import axiosIns from "./base";

/// Get Version
export async function getVersion() {
  return axiosIns.get("/version") as Promise<{
    premium: boolean;
    version: string;
  }>;
}

export interface ConfigType {
  port: number;
  mode: string;
  "socket-port": number;
  "allow-lan": boolean;
  "log-level": string;
  "mixed-port": number;
}

/// Get current base configs
export async function getConfigs() {
  return axiosIns.get("/configs") as Promise<ConfigType>;
}

/// Update current configs
export async function updateConfigs(config: Partial<ConfigType>) {
  return axiosIns.patch("/configs", config);
}

interface RuleItem {
  type: string;
  payload: string;
  proxy: string;
}

/// Get current rules
export async function getRules() {
  return axiosIns.get("/rules") as Promise<RuleItem[]>;
}

/// Get logs stream
export async function getLogs(callback: (t: any) => void) {
  const source = axios.CancelToken.source();

  axiosIns.get("/logs", {
    cancelToken: source.token,
    onDownloadProgress: (progressEvent) => {
      const data = progressEvent.currentTarget.response || "";
      const lastData = data.slice(data.trim().lastIndexOf("\n") + 1);
      callback(JSON.parse(lastData));
    },
  });

  return source;
}
