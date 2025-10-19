import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useVerge: vi.fn(),
  useAppData: vi.fn(),
  useSWR: vi.fn(),
  mutate: vi.fn(),
  closeAllConnections: vi.fn(),
  getAutotemProxy: vi.fn(),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: mocks.useVerge,
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: mocks.useAppData,
}));

vi.mock("swr", () => ({
  default: mocks.useSWR,
  mutate: mocks.mutate,
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeAllConnections: mocks.closeAllConnections,
}));

vi.mock("@/services/cmds", () => ({
  getAutotemProxy: mocks.getAutotemProxy,
}));

import { useSystemProxyState } from "@/hooks/use-system-proxy-state";

const useSWRMock = mocks.useSWR;
const mutateMock = mocks.mutate;
const closeAllConnectionsMock = mocks.closeAllConnections;

const createVergeContext = (
  overrides: Partial<IVergeConfig> = {},
  mutateOverride?: ReturnType<typeof vi.fn>,
  patchOverride?: ReturnType<typeof vi.fn>,
) => {
  const verge: IVergeConfig = {
    enable_system_proxy: false,
    proxy_auto_config: false,
    auto_close_connection: false,
    ...overrides,
  };
  const mutateVerge = mutateOverride ?? vi.fn();
  const patchVerge = patchOverride ?? vi.fn().mockResolvedValue(undefined);

  mocks.useVerge.mockReturnValue({
    verge,
    mutateVerge,
    patchVerge,
  });

  return { verge, mutateVerge, patchVerge };
};

const createAppDataContext = (sysproxyEnable: boolean) => {
  mocks.useAppData.mockReturnValue({
    sysproxy: { enable: sysproxyEnable },
  });
};

describe("useSystemProxyState", () => {
  beforeEach(() => {
    useSWRMock.mockReset();
    mutateMock.mockReset();
    closeAllConnectionsMock.mockReset();
    mocks.useVerge.mockReset();
    mocks.useAppData.mockReset();
    mocks.getAutotemProxy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives actual state from system proxy when auto config is disabled", () => {
    createAppDataContext(true);
    useSWRMock.mockReturnValue({ data: undefined });

    createVergeContext({
      enable_system_proxy: true,
      proxy_auto_config: false,
    });

    const { result } = renderHook(() => useSystemProxyState());

    expect(result.current.actualState).toBe(true);
    expect(result.current.indicator).toBe(true);
    expect(result.current.configState).toBe(true);
  });

  it("prefers automatic proxy data when auto config is enabled", () => {
    createAppDataContext(false);
    useSWRMock.mockReturnValue({ data: { enable: true } });

    createVergeContext({
      enable_system_proxy: true,
      proxy_auto_config: true,
    });

    const { result, rerender } = renderHook(() => useSystemProxyState());

    expect(result.current.actualState).toBe(true);
    expect(result.current.indicator).toBe(true);

    useSWRMock.mockReturnValue({ data: { enable: false } });
    act(() => {
      rerender();
    });

    expect(result.current.actualState).toBe(false);
    expect(result.current.indicator).toBe(false);
  });

  it("toggles proxy state, closes connections, and refreshes status on success", async () => {
    vi.useFakeTimers();
    createAppDataContext(false);
    useSWRMock.mockReturnValue({ data: { enable: false } });

    const mutateVerge = vi.fn();
    const patchVerge = vi.fn().mockResolvedValue(undefined);

    const { verge } = createVergeContext(
      {
        enable_system_proxy: true,
        proxy_auto_config: false,
        auto_close_connection: true,
      },
      mutateVerge,
      patchVerge,
    );

    mutateMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSystemProxyState());

    await act(async () => {
      result.current.toggleSystemProxy(false);
      await vi.runAllTimersAsync();
    });

    expect(mutateVerge).toHaveBeenCalledWith(
      { ...verge, enable_system_proxy: false },
      false,
    );
    expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
    expect(patchVerge).toHaveBeenCalledWith({ enable_system_proxy: false });
    expect(mutateMock).toHaveBeenCalledTimes(2);
    expect(mutateMock).toHaveBeenNthCalledWith(1, "getSystemProxy");
    expect(mutateMock).toHaveBeenNthCalledWith(2, "getAutotemProxy");
  });

  it("reverts optimistic update and logs when patch fails", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createAppDataContext(true);
    useSWRMock.mockReturnValue({ data: undefined });

    const mutateVerge = vi.fn();
    const patchVerge = vi.fn().mockRejectedValue(new Error("fail"));

    const { verge } = createVergeContext(
      {
        enable_system_proxy: true,
        proxy_auto_config: false,
        auto_close_connection: true,
      },
      mutateVerge,
      patchVerge,
    );

    const { result } = renderHook(() => useSystemProxyState());

    await act(async () => {
      result.current.toggleSystemProxy(false);
      await vi.runAllTimersAsync();
    });

    expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
    expect(mutateVerge).toHaveBeenNthCalledWith(
      1,
      { ...verge, enable_system_proxy: false },
      false,
    );
    expect(mutateVerge).toHaveBeenNthCalledWith(
      2,
      { ...verge, enable_system_proxy: true },
      false,
    );
    expect(patchVerge).toHaveBeenCalledWith({ enable_system_proxy: false });
    expect(mutateMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[useSystemProxyState] toggleSystemProxy failed:",
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
