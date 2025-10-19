import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderButton } from "@/components/proxy/provider-button";

const mocks = vi.hoisted(() => {
  const useAppDataMock = vi.fn();
  const updateProxyProviderMock = vi.fn();
  const refreshProxyMock = vi.fn();
  const refreshProxyProvidersMock = vi.fn();
  const showNoticeMock = vi.fn();
  const parseTrafficMock = vi.fn((value: number) => `${value}B`);

  const dayjsMock = vi.fn((_: unknown) => ({
    fromNow: () => "just now",
    format: () => "2025-01-01",
  }));

  return {
    useAppDataMock,
    updateProxyProviderMock,
    refreshProxyMock,
    refreshProxyProvidersMock,
    showNoticeMock,
    parseTrafficMock,
    dayjsMock,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: () => mocks.useAppDataMock(),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  updateProxyProvider: (name: string) => mocks.updateProxyProviderMock(name),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (type: unknown, message: unknown) =>
    mocks.showNoticeMock(type, message),
}));

vi.mock("@/utils/parse-traffic", () => ({
  __esModule: true,
  default: (value: number) => mocks.parseTrafficMock(value),
}));

vi.mock("dayjs", () => ({
  __esModule: true,
  default: (input?: unknown) => mocks.dayjsMock(input),
}));

const renderButton = () => render(<ProviderButton />);

describe("ProviderButton", () => {
  const {
    useAppDataMock,
    updateProxyProviderMock,
    refreshProxyMock,
    refreshProxyProvidersMock,
    showNoticeMock,
    parseTrafficMock,
    dayjsMock,
  } = mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    useAppDataMock.mockReturnValue({
      proxyProviders: {},
      refreshProxy: refreshProxyMock,
      refreshProxyProviders: refreshProxyProvidersMock,
    });
    updateProxyProviderMock.mockResolvedValue(undefined);
    refreshProxyMock.mockResolvedValue(undefined);
    refreshProxyProvidersMock.mockResolvedValue(undefined);
    showNoticeMock.mockReturnValue(undefined);
    parseTrafficMock.mockImplementation((value: number) => `${value}B`);
    dayjsMock.mockImplementation(() => ({
      fromNow: () => "just now",
      format: () => "2025-01-01",
    }));
  });

  it("does not render when there are no proxy providers", () => {
    renderButton();
    expect(
      screen.queryByRole("button", { name: "Proxy Provider" }),
    ).not.toBeInTheDocument();
  });

  it("opens dialog and displays provider details", async () => {
    useAppDataMock.mockReturnValue({
      proxyProviders: {
        "Provider-A": {
          proxies: ["a", "b"],
          vehicleType: "http",
          updatedAt: 1737050000,
          subscriptionInfo: {
            Upload: 10,
            Download: 20,
            Total: 100,
            Expire: 1737100000,
          },
        },
      },
      refreshProxy: refreshProxyMock,
      refreshProxyProviders: refreshProxyProvidersMock,
    });

    renderButton();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Proxy Provider" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Provider-A")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("http")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByTitle("Used / Total")).toHaveTextContent("30B / 100B");
    expect(screen.getByTitle("Expire Time")).toHaveTextContent("2025-01-01");
  });

  it("updates a single provider and shows success message", async () => {
    useAppDataMock.mockReturnValue({
      proxyProviders: {
        "Provider-A": {
          proxies: [],
          vehicleType: "http",
          updatedAt: 0,
          subscriptionInfo: null,
        },
      },
      refreshProxy: refreshProxyMock,
      refreshProxyProviders: refreshProxyProvidersMock,
    });

    renderButton();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Proxy Provider" }));

    const updateButton = await screen.findByTitle("Update Provider");
    await user.click(updateButton);

    await waitFor(() => {
      expect(updateProxyProviderMock).toHaveBeenCalledWith("Provider-A");
      expect(refreshProxyMock).toHaveBeenCalledTimes(1);
      expect(refreshProxyProvidersMock).toHaveBeenCalledTimes(1);
    });

    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Provider-A 更新成功",
    );
  });

  it("updates all providers and shows completion notice", async () => {
    useAppDataMock.mockReturnValue({
      proxyProviders: {
        "Provider-A": {
          proxies: [],
          vehicleType: "http",
          updatedAt: 0,
        },
        "Provider-B": {
          proxies: [],
          vehicleType: "https",
          updatedAt: 0,
        },
      },
      refreshProxy: refreshProxyMock,
      refreshProxyProviders: refreshProxyProvidersMock,
    });

    renderButton();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Proxy Provider" }));

    const updateAllButton = await screen.findByRole("button", {
      name: "Update All",
    });
    await user.click(updateAllButton);

    await waitFor(() => {
      expect(updateProxyProviderMock).toHaveBeenCalledTimes(2);
      expect(updateProxyProviderMock).toHaveBeenNthCalledWith(1, "Provider-A");
      expect(updateProxyProviderMock).toHaveBeenNthCalledWith(2, "Provider-B");
      expect(refreshProxyMock).toHaveBeenCalledTimes(1);
      expect(refreshProxyProvidersMock).toHaveBeenCalledTimes(1);
    });

    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "全部代理提供者更新成功",
    );
  });
});
