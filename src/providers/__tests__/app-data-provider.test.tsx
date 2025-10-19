import { renderHook, act } from "@testing-library/react";
import { PropsWithChildren, use } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { AppDataContext } from "@/providers/app-data-context";
import { AppDataProvider } from "@/providers/app-data-provider";

const listenMock = vi.fn();
const mockUseVerge = vi.fn();
const mockUseSWR = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => mockUseVerge(),
}));

vi.mock("@/services/cmds", () => ({
  calcuProxies: vi.fn(),
  calcuProxyProviders: vi.fn(),
  getAppUptime: vi.fn(),
  getRunningMode: vi.fn(),
  getSystemProxy: vi.fn(),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  getBaseConfig: vi.fn(),
  getRuleProviders: vi.fn(),
  getRules: vi.fn(),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: [unknown, unknown, unknown]) =>
    mockUseSWR(...args) as ReturnType<(typeof import("swr"))["default"]>,
}));

type SWRResponse<TData = unknown> = {
  data: TData;
  mutate: Mock;
};

type SWRSetupOptions = {
  proxiesData?: unknown;
  clashConfig?: { mixedPort?: number } | null;
  rulesData?: { rules?: unknown[] } | null;
  proxyProviders?: Record<string, unknown>;
  ruleProviders?: { providers?: Record<string, unknown> } | null;
  sysproxy?: { server?: string } | null;
  runningMode?: string | null;
  uptime?: number | null;
};

type RefreshMocks = {
  refreshProxy: Mock;
  refreshClashConfig: Mock;
  refreshRules: Mock;
  refreshSysproxy: Mock;
  refreshProxyProviders: Mock;
  refreshRuleProviders: Mock;
};

const swrResults = new Map<string, SWRResponse>();

const setSWRResponse = (key: string, value: SWRResponse) => {
  swrResults.set(key, value);
};

const resolveMutate = () => vi.fn().mockResolvedValue(undefined);

const setupSWRMocks = (options: SWRSetupOptions = {}): RefreshMocks => {
  const refreshProxy = resolveMutate();
  const refreshClashConfig = resolveMutate();
  const refreshRules = resolveMutate();
  const refreshSysproxy = resolveMutate();
  const refreshProxyProviders = resolveMutate();
  const refreshRuleProviders = resolveMutate();

  const {
    proxiesData = null,
    clashConfig = { mixedPort: 7897 },
    rulesData = { rules: [] },
    proxyProviders = {},
    ruleProviders = { providers: {} },
    sysproxy = { server: "-" },
    runningMode = "global",
    uptime = 0,
  } = options;

  setSWRResponse("getProxies", {
    data: proxiesData,
    mutate: refreshProxy,
  });

  setSWRResponse("getClashConfig", {
    data: clashConfig,
    mutate: refreshClashConfig,
  });

  setSWRResponse("getProxyProviders", {
    data: proxyProviders,
    mutate: refreshProxyProviders,
  });

  setSWRResponse("getRuleProviders", {
    data: ruleProviders,
    mutate: refreshRuleProviders,
  });

  setSWRResponse("getRules", {
    data: rulesData,
    mutate: refreshRules,
  });

  setSWRResponse("getSystemProxy", {
    data: sysproxy,
    mutate: refreshSysproxy,
  });

  setSWRResponse("getRunningMode", {
    data: runningMode,
    mutate: resolveMutate(),
  });

  setSWRResponse("appUptime", {
    data: uptime,
    mutate: resolveMutate(),
  });

  return {
    refreshProxy,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
  };
};

const useAppDataContext = () => {
  const context = use(AppDataContext);

  if (!context) {
    throw new Error("AppDataContext is not available");
  }

  return context;
};

const wrapper = ({ children }: PropsWithChildren) => (
  <AppDataProvider>{children}</AppDataProvider>
);

beforeEach(() => {
  swrResults.clear();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  mockUseVerge.mockReset();
  mockUseSWR.mockImplementation((key: unknown) => {
    const value = swrResults.get(String(key));
    if (!value) {
      throw new Error(`Missing SWR mock for key: ${String(key)}`);
    }
    return value;
  });
});

describe("AppDataProvider", () => {
  it("computes PAC mode system proxy address from verge configuration", () => {
    setupSWRMocks({
      clashConfig: { mixedPort: 9001 },
      sysproxy: { server: "192.168.1.10:7777" },
    });

    mockUseVerge.mockReturnValue({
      verge: {
        proxy_auto_config: true,
        proxy_host: "10.0.0.2",
        verge_mixed_port: 1234,
      },
      mutateVerge: vi.fn(),
      patchVerge: vi.fn(),
    });

    const { result } = renderHook(useAppDataContext, { wrapper });

    expect(result.current.systemProxyAddress).toBe("10.0.0.2:1234");
  });

  it("uses the system proxy address when PAC mode is disabled and the address is valid", () => {
    setupSWRMocks({
      clashConfig: { mixedPort: 4567 },
      sysproxy: { server: "172.16.0.10:8080" },
    });

    mockUseVerge.mockReturnValue({
      verge: {
        proxy_auto_config: false,
        proxy_host: "10.10.0.2",
        verge_mixed_port: 9999,
      },
      mutateVerge: vi.fn(),
      patchVerge: vi.fn(),
    });

    const { result } = renderHook(useAppDataContext, { wrapper });

    expect(result.current.systemProxyAddress).toBe("172.16.0.10:8080");
  });

  it("falls back to the expected address when the system proxy is invalid", () => {
    setupSWRMocks({
      clashConfig: { mixedPort: 6000 },
      sysproxy: { server: ":7890" },
    });

    mockUseVerge.mockReturnValue({
      verge: {
        proxy_auto_config: false,
        verge_mixed_port: undefined,
      },
      mutateVerge: vi.fn(),
      patchVerge: vi.fn(),
    });

    const { result } = renderHook(useAppDataContext, { wrapper });

    expect(result.current.systemProxyAddress).toBe("127.0.0.1:6000");
  });

  it("refreshes all SWR resources through the aggregated refreshAll handler", async () => {
    const refreshMocks = setupSWRMocks({
      clashConfig: { mixedPort: 7000 },
      sysproxy: { server: "-" },
    });

    mockUseVerge.mockReturnValue({
      verge: {
        proxy_auto_config: true,
      },
      mutateVerge: vi.fn(),
      patchVerge: vi.fn(),
    });

    const { result } = renderHook(useAppDataContext, { wrapper });

    await act(async () => {
      await result.current.refreshAll();
    });

    expect(refreshMocks.refreshProxy).toHaveBeenCalledTimes(1);
    expect(refreshMocks.refreshClashConfig).toHaveBeenCalledTimes(1);
    expect(refreshMocks.refreshRules).toHaveBeenCalledTimes(1);
    expect(refreshMocks.refreshSysproxy).toHaveBeenCalledTimes(1);
    expect(refreshMocks.refreshProxyProviders).toHaveBeenCalledTimes(1);
    expect(refreshMocks.refreshRuleProviders).toHaveBeenCalledTimes(1);
  });
});
