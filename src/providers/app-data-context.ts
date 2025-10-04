import { createContext, use } from "react";

export interface AppDataContextType {
  proxies: any;
  clashConfig: any;
  rules: any[];
  sysproxy: any;
  runningMode?: string;
  uptime: number;
  proxyProviders: any;
  ruleProviders: any;
  connections: {
    data: ConnectionWithSpeed[];
    count: number;
    uploadTotal: number;
    downloadTotal: number;
  };
  traffic: { up: number; down: number };
  memory: { inuse: number };
  systemProxyAddress: string;

  refreshProxy: () => Promise<any>;
  refreshClashConfig: () => Promise<any>;
  refreshRules: () => Promise<any>;
  refreshSysproxy: () => Promise<any>;
  refreshProxyProviders: () => Promise<any>;
  refreshRuleProviders: () => Promise<any>;
  refreshAll: () => Promise<any>;
}

export interface ConnectionWithSpeed extends IConnectionsItem {
  curUpload: number;
  curDownload: number;
}

export interface ConnectionSpeedData {
  id: string;
  upload: number;
  download: number;
  timestamp: number;
}

export const AppDataContext = createContext<AppDataContextType | null>(null);

export const useAppData = () => {
  const context = use(AppDataContext);

  if (!context) {
    throw new Error("useAppData必须在AppDataProvider内使用");
  }

  return context;
};
