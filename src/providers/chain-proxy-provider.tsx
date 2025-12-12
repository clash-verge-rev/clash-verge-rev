import React, { useCallback, useMemo, useState } from "react";

import { ChainProxyContext } from "./chain-proxy-context";

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

  const contextValue = useMemo(
    () => ({
      isChainMode,
      setChainMode,
      chainConfigData,
      setChainConfigData: setChainConfigDataCallback,
    }),
    [isChainMode, setChainMode, chainConfigData, setChainConfigDataCallback],
  );

  return <ChainProxyContext value={contextValue}>{children}</ChainProxyContext>;
};
