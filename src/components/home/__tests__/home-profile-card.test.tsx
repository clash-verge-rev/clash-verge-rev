import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeProfileCard } from "@/components/home/home-profile-card";
import { useAppData } from "@/providers/app-data-context";
import type { AppDataContextType } from "@/providers/app-data-context";

const mockNavigate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/home/enhanced-card", () => ({
  EnhancedCard: ({
    title,
    action,
    children,
  }: {
    title: ReactNode;
    action: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="enhanced-card">
      <span data-testid="card-title">{title}</span>
      <div data-testid="card-action">{action}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("ahooks", () => ({
  useLockFn: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: vi.fn(),
}));

const { updateProfileMock, openWebUrlMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(),
  openWebUrlMock: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({
  updateProfile: updateProfileMock,
  openWebUrl: openWebUrlMock,
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: vi.fn(),
}));

const useAppDataMock = vi.mocked(useAppData);

const createAppDataValue = (
  overrides: Partial<AppDataContextType> = {},
): AppDataContextType =>
  ({
    proxies: {},
    clashConfig: {} as AppDataContextType["clashConfig"],
    rules: [] as AppDataContextType["rules"],
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

describe("HomeProfileCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  it("shows empty profile state and routes to profile page on click", () => {
    useAppDataMock.mockReturnValue(createAppDataValue());

    render(<HomeProfileCard current={null} />);

    const importProfiles = screen.getByText("Import Profiles");
    expect(importProfiles).toBeInTheDocument();

    fireEvent.click(importProfiles);

    expect(mockNavigate).toHaveBeenCalledWith("/profile");
  });

  it("renders current profile details and handles actions", async () => {
    const refreshAll = vi.fn();
    const onProfileUpdated = vi.fn();

    useAppDataMock.mockReturnValue(
      createAppDataValue({
        refreshAll,
      }),
    );

    updateProfileMock.mockResolvedValue(undefined);

    const currentProfile = {
      uid: "profile-1",
      name: "Primary Profile",
      url: "https://example.com/subscription",
      home: "https://example.com/",
      updated: 1_700_000_000,
      option: { foo: "bar" },
      extra: {
        upload: 500,
        download: 300,
        total: 1000,
        expire: 1_700_000_000,
      },
    };

    render(
      <HomeProfileCard
        current={currentProfile}
        onProfileUpdated={onProfileUpdated}
      />,
    );

    expect(screen.getByTestId("card-title").textContent).toContain(
      "Primary Profile",
    );
    expect(
      screen.getByText((content) => content.startsWith("From")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "example.com" }),
    ).toBeInTheDocument();

    const usageRow = screen.getByText((content) =>
      content.startsWith("Used / Total"),
    );
    expect(usageRow).toHaveTextContent(/Used \/ Total:\s*800B\s*\/\s*1000B/);

    expect(
      screen.getByText((content) => content.startsWith("Expire Time")),
    ).toHaveTextContent(/Expire Time:\s*2023-11-15/);

    fireEvent.click(screen.getByRole("button", { name: "Label-Profiles" }));
    expect(mockNavigate).toHaveBeenCalledWith("/profile");

    fireEvent.click(screen.getByRole("button", { name: "example.com" }));
    expect(openWebUrlMock).toHaveBeenCalledWith(currentProfile.home);

    fireEvent.click(screen.getByText(/Update Time/));

    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledWith(
        currentProfile.uid,
        currentProfile.option,
      );
      expect(refreshAll).toHaveBeenCalled();
      expect(onProfileUpdated).toHaveBeenCalled();
    });
  });
});
