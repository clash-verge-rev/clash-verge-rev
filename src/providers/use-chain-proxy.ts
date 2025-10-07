import { use } from "react";

import { ChainProxyContext } from "./chain-proxy-context";

export const useChainProxy = () => {
  const context = use(ChainProxyContext);
  if (!context) {
    throw new Error("useChainProxy must be used within a ChainProxyProvider");
  }
  return context;
};
