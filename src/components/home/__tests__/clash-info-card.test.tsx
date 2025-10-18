import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClashInfoCard } from "@/components/home/clash-info-card";
import { useClash } from "@/hooks/use-clash";
import { useAppData } from "@/providers/app-data-context";
import type { AppDataContextType } from "@/providers/app-data-context";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/home/enhanced-card", () => ({
  EnhancedCard: ({
    title,
    children,
  }: {
    title: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="enhanced-card">
      <span data-testid="card-title">{title}</span>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/hooks/use-clash", () => ({
  useClash: vi.fn(),
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: vi.fn(),
}));

const useClashMock = vi.mocked(useClash);
const useAppDataMock = vi.mocked(useAppData);

const createAppDataValue = (
  overrides: Partial<AppDataContextType>,
): AppDataContextType =>
  ({
    proxies: {},
    clashConfig: { mixedPort: 0 } as AppDataContextType["clashConfig"],
    rules: [],
    sysproxy: {},
    runningMode: "rule",
    uptime: 0,
    proxyProviders: {},
    ruleProviders: {},
    systemProxyAddress: "",
    refreshProxy: vi.fn(),
    refreshClashConfig: vi.fn(),
    refreshRules: vi.fn(),
    refreshSysproxy: vi.fn(),
    refreshProxyProviders: vi.fn(),
    refreshRuleProviders: vi.fn(),
    refreshAll: vi.fn(),
    ...overrides,
  }) as AppDataContextType;

describe("ClashInfoCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useClashMock.mockReturnValue({ version: "2024.1" } as ReturnType<
      typeof useClash
    >);
    useAppDataMock.mockReturnValue(
      createAppDataValue({
        clashConfig: { mixedPort: 7890 } as AppDataContextType["clashConfig"],
        rules: [{ id: 1 }, { id: 2 }] as unknown as AppDataContextType["rules"],
        uptime: 3661000,
        systemProxyAddress: "127.0.0.1:7890",
      }),
    );
  });

  it("renders clash information when configuration is available", () => {
    render(<ClashInfoCard />);

    expect(screen.getByTestId("card-title").textContent).toBe("Clash Info");
    expect(screen.getByText("Core Version")).toBeInTheDocument();
    expect(screen.getByText("2024.1")).toBeInTheDocument();
    expect(screen.getByText("System Proxy Address")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:7890")).toBeInTheDocument();
    expect(screen.getByText("Mixed Port")).toBeInTheDocument();
    expect(screen.getByText("7890")).toBeInTheDocument();
    expect(screen.getByText("Rules Count")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Uptime")).toBeInTheDocument();
    expect(screen.getByText("1:01:01")).toBeInTheDocument();
  });

  it("renders empty content when configuration is missing", () => {
    useAppDataMock.mockReturnValue(
      createAppDataValue({
        clashConfig: undefined as unknown as AppDataContextType["clashConfig"],
      }),
    );

    render(<ClashInfoCard />);

    expect(screen.getByTestId("card-title").textContent).toBe("Clash Info");
    expect(screen.queryByText("Core Version")).toBeNull();
    expect(screen.queryByText("Rules Count")).toBeNull();
  });
});
