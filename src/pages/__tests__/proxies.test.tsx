import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";

const closeAllConnectionsMock = vi.fn();
const patchClashModeMock = vi.fn();
const updateProxyChainConfigInRuntimeMock = vi.fn();
const getRuntimeProxyChainConfigMock = vi.fn();

const mutateMock = vi.fn();
const proxyGroupsMock = vi.fn();
let useSWRState: { data: any; mutate: () => void } | null = null;
let vergeState: any = { auto_close_connection: true };

vi.mock("swr", () => {
  const useSWRMock = (...args: any[]) => {
    void args;
    return useSWRState ?? { data: null, mutate: vi.fn() };
  };
  return { __esModule: true, default: useSWRMock };
});

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeAllConnections: (...args: Parameters<typeof closeAllConnectionsMock>) =>
    closeAllConnectionsMock(...args),
  getBaseConfig: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({
  patchClashMode: (...args: Parameters<typeof patchClashModeMock>) =>
    patchClashModeMock(...args),
  updateProxyChainConfigInRuntime: (
    ...args: Parameters<typeof updateProxyChainConfigInRuntimeMock>
  ) => updateProxyChainConfigInRuntimeMock(...args),
  getRuntimeProxyChainConfig: (
    ...args: Parameters<typeof getRuntimeProxyChainConfigMock>
  ) => getRuntimeProxyChainConfigMock(...args),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({ verge: vergeState }),
}));

vi.mock("@/components/proxy/provider-button", () => ({
  ProviderButton: () => <div data-testid="provider-button">provider</div>,
}));

vi.mock("@/components/proxy/proxy-groups", () => ({
  ProxyGroups: ({
    mode,
    isChainMode,
    ...rest
  }: {
    mode: string;
    isChainMode: boolean;
  }) => {
    proxyGroupsMock({ mode, isChainMode, ...rest });
    return (
      <div
        data-testid="proxy-groups"
        data-mode={mode}
        data-chain={isChainMode ? "true" : "false"}
      />
    );
  },
}));

const ProxyPageModule = await import("@/pages/proxies");
const ProxyPage = ProxyPageModule.default;

describe("ProxyPage", () => {
  beforeEach(() => {
    closeAllConnectionsMock.mockReset();
    patchClashModeMock.mockReset();
    updateProxyChainConfigInRuntimeMock.mockReset();
    getRuntimeProxyChainConfigMock.mockReset();
    mutateMock.mockReset();
    proxyGroupsMock.mockReset();
    useSWRState = { data: { mode: "Rule" }, mutate: mutateMock };
    vergeState = { auto_close_connection: true };
    localStorage.clear();
  });

  it("renders with default proxy title and passes props to ProxyGroups", () => {
    render(<ProxyPage />);

    expect(screen.getByTestId("base-page-title")).toHaveTextContent(
      "Proxy Groups",
    );
    expect(screen.getByTestId("proxy-groups").dataset.mode).toBe("rule");
  });

  it("changes Clash mode and closes connections when required", async () => {
    const user = userEvent.setup();
    render(<ProxyPage />);

    await user.click(screen.getByRole("button", { name: "global" }));

    expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
    expect(patchClashModeMock).toHaveBeenCalledWith("global");
    expect(mutateMock).toHaveBeenCalled();
  });

  it("remembers chain mode, fetches chain config, and clears when toggled off", async () => {
    localStorage.setItem("proxy-chain-mode-enabled", "true");
    localStorage.setItem("proxy-chain-exit-node", "exit-1");
    getRuntimeProxyChainConfigMock.mockResolvedValueOnce("chain-config");

    render(<ProxyPage />);

    expect(screen.getByTestId("base-page-title")).toHaveTextContent(
      "Proxy Chain Mode",
    );

    await waitFor(() => {
      expect(getRuntimeProxyChainConfigMock).toHaveBeenCalledWith("exit-1");
    });
    expect(proxyGroupsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isChainMode: true,
        chainConfigData: "chain-config",
      }),
    );

    const user = userEvent.setup();
    const toggleButton = screen.getByRole("button", { name: "Chain Proxy" });
    await user.click(toggleButton);

    expect(updateProxyChainConfigInRuntimeMock).toHaveBeenCalledWith(null);
    expect(localStorage.getItem("proxy-chain-mode-enabled")).toBe("false");
    await waitFor(() => {
      expect(screen.getByTestId("base-page-title")).toHaveTextContent(
        "Proxy Groups",
      );
    });
  });
});
