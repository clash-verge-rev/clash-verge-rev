import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HomeCardsState = Record<string, boolean>;

const vergeState: { home_cards: HomeCardsState } = {
  home_cards: {
    profile: true,
    proxy: true,
    network: true,
    mode: true,
    traffic: true,
    test: true,
    ip: true,
    clashinfo: true,
    systeminfo: true,
    info: false,
  },
};

const patchVergeMock = vi.fn(async (value: { home_cards: HomeCardsState }) => {
  void value;
});
const openWebUrlMock = vi.fn(async (url: string) => {
  void url;
});
const entryLightweightModeMock = vi.fn(async () => {});
const mutateProfilesMock = vi.fn();
const requestIdleCallbackMock = vi.fn<
  (callback: IdleRequestCallback) => number
>(() => 1);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock("@/components/base", () => ({
  BasePage: ({
    title,
    header,
    children,
  }: {
    title?: ReactNode;
    header?: ReactNode;
    children?: ReactNode;
  }) => (
    <div data-testid="base-page">
      <div data-testid="base-page-title">{title}</div>
      <div data-testid="base-page-header">{header}</div>
      <div data-testid="base-page-content">{children}</div>
    </div>
  ),
}));

vi.mock("@/components/home/home-profile-card", () => ({
  HomeProfileCard: () => <div data-testid="profile-card">ProfileCard</div>,
}));

vi.mock("@/components/home/current-proxy-card", () => ({
  CurrentProxyCard: () => <div data-testid="proxy-card">CurrentProxy</div>,
}));

vi.mock("@/components/home/proxy-tun-card", () => ({
  ProxyTunCard: () => <div data-testid="proxy-tun-card">ProxyTun</div>,
}));

vi.mock("@/components/home/clash-mode-card", () => ({
  ClashModeCard: () => <div data-testid="clash-mode-card">ClashMode</div>,
}));

vi.mock("@/components/home/enhanced-traffic-stats", () => ({
  EnhancedTrafficStats: () => (
    <div data-testid="traffic-stats">TrafficStats</div>
  ),
}));

vi.mock("@/components/home/enhanced-card", () => ({
  EnhancedCard: ({
    title,
    children,
  }: {
    title: ReactNode;
    children?: ReactNode;
  }) => {
    const label =
      typeof title === "string"
        ? title.toLowerCase().replace(/\s+/g, "-")
        : "unknown";

    return (
      <div data-testid={`enhanced-card-${label}`}>
        <span>{title}</span>
        {children}
      </div>
    );
  },
}));

vi.mock("@/components/home/test-card", () => ({
  TestCard: () => <div data-testid="test-card">TestCard</div>,
}));

vi.mock("@/components/home/ip-info-card", () => ({
  IpInfoCard: () => <div data-testid="ip-info-card">IpInfo</div>,
}));

vi.mock("@/components/home/clash-info-card", () => ({
  ClashInfoCard: () => <div data-testid="clash-info-card">ClashInfo</div>,
}));

vi.mock("@/components/home/system-info-card", () => ({
  SystemInfoCard: () => <div data-testid="system-info-card">SystemInfo</div>,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({
    verge: { home_cards: vergeState.home_cards },
    patchVerge: patchVergeMock,
  }),
}));

vi.mock("@/hooks/use-profiles", () => ({
  useProfiles: () => ({
    current: { uid: "profile-1", name: "Main Profile" },
    mutateProfiles: mutateProfilesMock,
  }),
}));

vi.mock("@/services/cmds", () => ({
  entry_lightweight_mode: entryLightweightModeMock,
  openWebUrl: openWebUrlMock,
}));

const HomePageModule = await import("@/pages/home");
const HomePage = HomePageModule.default;

describe("HomePage", () => {
  let originalRequestIdleCallback: typeof window.requestIdleCallback;

  beforeEach(() => {
    originalRequestIdleCallback = window.requestIdleCallback;
    patchVergeMock.mockImplementation(async () => {});
    patchVergeMock.mockClear();
    openWebUrlMock.mockImplementation(async () => {});
    openWebUrlMock.mockClear();
    entryLightweightModeMock.mockImplementation(async () => {});
    entryLightweightModeMock.mockClear();
    mutateProfilesMock.mockClear();
    requestIdleCallbackMock.mockImplementation((callback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 1,
      } as IdleDeadline);
      return 1;
    });
    requestIdleCallbackMock.mockClear();

    (window as any).requestIdleCallback = requestIdleCallbackMock;

    vergeState.home_cards = {
      profile: true,
      proxy: true,
      network: true,
      mode: true,
      traffic: true,
      test: true,
      ip: true,
      clashinfo: true,
      systeminfo: true,
      info: false,
    };
  });

  afterEach(() => {
    (window as any).requestIdleCallback = originalRequestIdleCallback;
  });

  it("renders cards based on the Verge home card settings", async () => {
    vergeState.home_cards = {
      profile: true,
      proxy: false,
      network: true,
      mode: false,
      traffic: true,
      test: false,
      ip: false,
      clashinfo: true,
      systeminfo: false,
      info: false,
    };

    render(<HomePage />);

    expect(await screen.findByTestId("profile-card")).toBeInTheDocument();
    expect(screen.queryByTestId("proxy-card")).toBeNull();
    expect(
      await screen.findByTestId("enhanced-card-network-settings"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("clash-mode-card")).toBeNull();
    expect(
      await screen.findByTestId("enhanced-card-traffic-stats"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("test-card")).toBeNull();
    expect(await screen.findByTestId("clash-info-card")).toBeInTheDocument();
    expect(screen.queryByTestId("system-info-card")).toBeNull();
  });

  it("allows toggling cards from the settings dialog and persists the changes", async () => {
    const user = userEvent.setup();

    render(<HomePage />);

    const settingsButton = screen
      .getByTestId("SettingsOutlinedIcon")
      .closest("button");
    expect(settingsButton).not.toBeNull();

    await user.click(settingsButton!);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    const trafficCheckbox = screen.getByRole("checkbox", {
      name: "Traffic Stats Card",
    });
    expect(trafficCheckbox).toBeChecked();

    await user.click(trafficCheckbox);
    expect(trafficCheckbox).not.toBeChecked();

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(patchVergeMock).toHaveBeenCalledTimes(1);
    });

    expect(patchVergeMock).toHaveBeenCalledWith({
      home_cards: expect.objectContaining({
        traffic: false,
      }),
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("enhanced-card-traffic-stats"),
      ).not.toBeInTheDocument();
    });
  });

  it("provides quick actions for documentation and lightweight mode", async () => {
    const user = userEvent.setup();

    render(<HomePage />);

    const docButton = screen
      .getByTestId("HelpOutlineRoundedIcon")
      .closest("button");
    expect(docButton).not.toBeNull();
    await user.click(docButton!);

    expect(openWebUrlMock).toHaveBeenCalledWith(
      "https://clash-verge-rev.github.io/index.html",
    );

    const lightweightButton = screen
      .getByTestId("HistoryEduOutlinedIcon")
      .closest("button");
    expect(lightweightButton).not.toBeNull();
    await user.click(lightweightButton!);

    expect(entryLightweightModeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to setTimeout when requestIdleCallback is unavailable", async () => {
    const user = userEvent.setup();
    const original = window.requestIdleCallback;
    (window as any).requestIdleCallback = undefined;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    render(<HomePage />);

    const settingsButton = screen
      .getByTestId("SettingsOutlinedIcon")
      .closest("button");
    expect(settingsButton).not.toBeNull();
    await user.click(settingsButton!);

    const trafficCheckbox = await screen.findByRole("checkbox", {
      name: "Traffic Stats Card",
    });
    await user.click(trafficCheckbox);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(setTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    (window as any).requestIdleCallback = original;
  });
});
