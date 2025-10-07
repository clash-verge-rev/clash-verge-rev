import { createContext } from "react";

interface ChainProxyContextType {
  isChainMode: boolean;
  setChainMode: (isChain: boolean) => void;
  chainConfigData: string | null;
  setChainConfigData: (data: string | null) => void;
}

export const ChainProxyContext = createContext<ChainProxyContextType | null>(
  null,
);
