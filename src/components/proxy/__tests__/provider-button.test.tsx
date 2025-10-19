import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderButton } from "@/components/proxy/provider-button";

dayjs.extend(relativeTime);

const {
  useAppDataMock,
  showNoticeMock,
  updateProxyProviderMock,
  parseTrafficMock,
} = vi.hoisted(() => ({
  useAppDataMock: vi.fn(),
  showNoticeMock: vi.fn(),
  updateProxyProviderMock: vi.fn(),
  parseTrafficMock: vi.fn((value: number) => `${value}B`),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("ahooks", () => ({
  useLockFn: (fn: (...args: unknown[]) => Promise<unknown> | unknown) => fn,
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  updateProxyProvider: updateProxyProviderMock,
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: () => useAppDataMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/utils/parse-traffic", () => ({
  __esModule: true,
  default: (value: number) => parseTrafficMock(value),
}));

interface MockProviderInfo {
  proxies: Array<{ name: string }>;
  vehicleType: string;
  updatedAt: number;
  subscriptionInfo?: {
    Upload?: number;
    Download?: number;
    Total?: number;
    Expire?: number;
  };
}

const createProviders = (): Record<string, MockProviderInfo> => ({
  AlphaProvider: {
    proxies: [{ name: "a" }, { name: "b" }],
    vehicleType: "http",
    updatedAt: Date.now() - 60_000,
    subscriptionInfo: {
      Upload: 10,
      Download: 20,
      Total: 100,
      Expire: Math.floor(Date.now() / 1000) + 3600,
    },
  },
  BetaProvider: {
    proxies: [{ name: "c" }],
    vehicleType: "https",
    updatedAt: Date.now() - 120_000,
  },
});

const createAppDataValue = (
  overrides: Partial<{
    proxyProviders: Record<string, MockProviderInfo>;
    refreshProxy: ReturnType<typeof vi.fn>;
    refreshProxyProviders: ReturnType<typeof vi.fn>;
  }> = {},
) => {
  const refreshProxy = vi.fn().mockResolvedValue(undefined);
  const refreshProxyProviders = vi.fn().mockResolvedValue(undefined);
  return {
    proxyProviders: {},
    refreshProxy,
    refreshProxyProviders,
    ...overrides,
  };
};

type AppDataMockValue = ReturnType<typeof createAppDataValue>;

const renderWithAppData = (overrides: Partial<AppDataMockValue> = {}) => {
  const value = createAppDataValue(overrides);
  useAppDataMock.mockReturnValue(value);
  return { value, ...render(<ProviderButton />) };
};

describe("ProviderButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there are no providers", () => {
    renderWithAppData();

    const button = screen.queryByText("Proxy Provider");
    expect(button).toBeNull();
  });

  it("renders provider dialog with provider details", () => {
    renderWithAppData({ proxyProviders: createProviders() });

    fireEvent.click(screen.getByText("Proxy Provider"));

    expect(screen.getByText("Update All")).toBeInTheDocument();
    expect(screen.getByText("AlphaProvider")).toBeInTheDocument();
    expect(screen.getByText("BetaProvider")).toBeInTheDocument();
    expect(parseTrafficMock).toHaveBeenCalledWith(30);
    expect(parseTrafficMock).toHaveBeenCalledWith(100);
  });

  it("updates all providers when update all button is clicked", async () => {
    const { value } = renderWithAppData({ proxyProviders: createProviders() });

    updateProxyProviderMock.mockResolvedValue(undefined);

    fireEvent.click(screen.getByText("Proxy Provider"));
    fireEvent.click(screen.getByText("Update All"));

    await waitFor(() => {
      expect(updateProxyProviderMock).toHaveBeenCalledTimes(2);
    });

    expect(updateProxyProviderMock).toHaveBeenNthCalledWith(1, "AlphaProvider");
    expect(updateProxyProviderMock).toHaveBeenNthCalledWith(2, "BetaProvider");
    expect(value.refreshProxy).toHaveBeenCalledTimes(1);
    expect(value.refreshProxyProviders).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith("success", expect.any(String));
  });

  it("updates a single provider from the list", async () => {
    const { value } = renderWithAppData({ proxyProviders: createProviders() });

    updateProxyProviderMock.mockResolvedValue(undefined);

    fireEvent.click(screen.getByText("Proxy Provider"));
    const updateButtons = screen.getAllByTitle("Update Provider");
    fireEvent.click(updateButtons[0]);

    await waitFor(() => {
      expect(updateProxyProviderMock).toHaveBeenCalledWith("AlphaProvider");
    });

    expect(value.refreshProxy).toHaveBeenCalledTimes(1);
    expect(value.refreshProxyProviders).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      expect.stringContaining("AlphaProvider"),
    );
  });
});
