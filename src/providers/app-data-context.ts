import { createContext, use } from "react";
import {
  BaseConfig,
  ProxyProvider,
  Rule,
  RuleProvider,
} from "tauri-plugin-mihomo-api";

export interface AppDataContextType {
  proxies: any;
  clashConfig: BaseConfig;
  rules: Rule[];
  sysproxy: any;
  runningMode?: string;
  uptime: number;
  proxyProviders: Record<string, ProxyProvider>;
  ruleProviders: Record<string, RuleProvider>;
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
    throw new Error("useAppData must be used within AppDataProvider");
  }

  return context;
};
