import { act, renderHook } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { useChainProxy } from "@/providers/chain-proxy-context";
import { ChainProxyProvider } from "@/providers/chain-proxy-provider";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChainProxyProvider>{children}</ChainProxyProvider>
);

describe("ChainProxyProvider", () => {
  it("throws when useChainProxy is used outside of the provider", () => {
    expect(() => renderHook(() => useChainProxy())).toThrowError(
      "useChainProxy must be used within a ChainProxyProvider",
    );
  });

  it("provides default context values", () => {
    const { result } = renderHook(() => useChainProxy(), { wrapper });

    expect(result.current.isChainMode).toBe(false);
    expect(result.current.chainConfigData).toBeNull();
    expect(typeof result.current.setChainMode).toBe("function");
    expect(typeof result.current.setChainConfigData).toBe("function");
  });

  it("updates chain mode and config data while keeping setter references stable", () => {
    const { result } = renderHook(() => useChainProxy(), { wrapper });

    const initialSetChainMode = result.current.setChainMode;
    const initialSetChainConfigData = result.current.setChainConfigData;

    act(() => {
      result.current.setChainMode(true);
      result.current.setChainConfigData("config:a");
    });

    expect(result.current.isChainMode).toBe(true);
    expect(result.current.chainConfigData).toBe("config:a");
    expect(result.current.setChainMode).toBe(initialSetChainMode);
    expect(result.current.setChainConfigData).toBe(initialSetChainConfigData);

    act(() => {
      result.current.setChainMode(false);
      result.current.setChainConfigData(null);
    });

    expect(result.current.isChainMode).toBe(false);
    expect(result.current.chainConfigData).toBeNull();
  });
});
