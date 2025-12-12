import { createContext, use } from "react";

export interface ChainProxyContextType {
  isChainMode: boolean;
  setChainMode: (isChain: boolean) => void;
  chainConfigData: string | null;
  setChainConfigData: (data: string | null) => void;
}

export const ChainProxyContext = createContext<ChainProxyContextType | null>(
  null,
);

export const useChainProxy = () => {
  const context = use(ChainProxyContext);
  if (!context) {
    throw new Error("useChainProxy must be used within a ChainProxyProvider");
  }
  return context;
};
