import React, { createContext, useCallback, useContext, useState } from "react";

interface ChainProxyContextType {
  isChainMode: boolean;
  setChainMode: (isChain: boolean) => void;
  chainConfigData: string | null;
  setChainConfigData: (data: string | null) => void;
}

const ChainProxyContext = createContext<ChainProxyContextType | null>(null);

export const ChainProxyProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [isChainMode, setIsChainMode] = useState(false);
  const [chainConfigData, setChainConfigData] = useState<string | null>(null);

  const setChainMode = useCallback((isChain: boolean) => {
    setIsChainMode(isChain);
  }, []);

  const setChainConfigDataCallback = useCallback((data: string | null) => {
    setChainConfigData(data);
  }, []);

  return (
    <ChainProxyContext.Provider
      value={{
        isChainMode,
        setChainMode,
        chainConfigData,
        setChainConfigData: setChainConfigDataCallback,
      }}
    >
      {children}
    </ChainProxyContext.Provider>
  );
};

export const useChainProxy = () => {
  const context = useContext(ChainProxyContext);
  if (!context) {
    throw new Error("useChainProxy must be used within a ChainProxyProvider");
  }
  return context;
};
