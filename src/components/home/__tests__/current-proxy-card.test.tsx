import { ThemeProvider, createTheme } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CurrentProxyCard } from "@/components/home/current-proxy-card";

const STORAGE_KEY_GROUP = "clash-verge-selected-proxy-group";
const STORAGE_KEY_PROXY = "clash-verge-selected-proxy";
const STORAGE_KEY_SORT = "clash-verge-proxy-sort-type";

const delayManagerMock = vi.hoisted(() => ({
  getDelayFix: vi.fn((record: any) => record?.delay ?? -1),
  formatDelay: vi.fn((delay: number) => `${delay}ms`),
  formatDelayColor: vi.fn(() => "success.main"),
  checkDelay: vi.fn(),
  checkListDelay: vi.fn(),
  getUrl: vi.fn(() => "http://latency.test"),
}));

const proxySelectionMock = vi.hoisted(() => vi.fn(() => vi.fn()));

const appDataState = vi.hoisted(() => ({
  proxies: {
    groups: [
      {
        name: "SelectorOne",
        type: "Selector",
        now: "ProxyA",
        all: [{ name: "ProxyA" }, { name: "ProxyB" }],
      },
    ],
    records: {
      ProxyA: { name: "ProxyA", type: "http", delay: 120 },
      ProxyB: { name: "ProxyB", type: "vmess", delay: 250 },
    },
  },
  clashConfig: { mode: "rule" },
  refreshProxy: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("ahooks", () => ({
  useLockFn: (fn: any) => fn,
}));

vi.mock("@/services/delay", () => ({
  __esModule: true,
  default: delayManagerMock,
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  delayGroup: vi.fn(),
  healthcheckProxyProvider: vi.fn(),
}));

vi.mock("@/hooks/use-proxy-selection", () => ({
  useProxySelection: () => ({
    handleSelectChange: proxySelectionMock,
  }),
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: () => appDataState,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({
    verge: {
      enable_auto_delay_detection: false,
      default_latency_timeout: 8000,
    },
  }),
}));

vi.mock("@/hooks/use-profiles", () => ({
  useProfiles: () => ({
    current: { uid: "profile-1" },
  }),
}));

const renderCard = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <CurrentProxyCard />
    </ThemeProvider>,
  );

describe("CurrentProxyCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appDataState.proxies = {
      groups: [
        {
          name: "SelectorOne",
          type: "Selector",
          now: "ProxyA",
          all: [{ name: "ProxyA" }, { name: "ProxyB" }],
        },
      ],
      records: {
        ProxyA: { name: "ProxyA", type: "http", delay: 120 },
        ProxyB: { name: "ProxyB", type: "vmess", delay: 250 },
      },
    } as any;
    appDataState.clashConfig = { mode: "rule" } as any;
  });

  it("migrates stored selections to profile scoped keys and renders proxy info", async () => {
    localStorage.setItem(STORAGE_KEY_GROUP, "SelectorOne");
    localStorage.setItem(STORAGE_KEY_PROXY, "ProxyB");

    renderCard();

    await waitFor(() => {
      expect(screen.getAllByText("ProxyA").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(localStorage.getItem(`${STORAGE_KEY_GROUP}:profile-1`)).toBe(
        "SelectorOne",
      );
    });

    expect(localStorage.getItem(STORAGE_KEY_GROUP)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEY_PROXY}:profile-1`)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY_PROXY)).toBe("ProxyB");

    expect(screen.getAllByText("ProxyA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("120ms").length).toBeGreaterThan(0);
  });

  it("cycles sort type and persists selection in local storage", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getAllByText("ProxyA").length).toBeGreaterThan(0);
    });

    const sortButton = screen.getByRole("button", { name: "Sort by default" });

    fireEvent.click(sortButton);
    await waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY_SORT)).toBe("1"),
    );
    expect(
      sortButton.querySelector('[data-testid="AccessTimeRoundedIcon"]'),
    ).not.toBeNull();
    expect(sortButton).toHaveAttribute("aria-label", "Sort by delay");

    fireEvent.click(sortButton);
    await waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY_SORT)).toBe("2"),
    );
    expect(
      sortButton.querySelector('[data-testid="SortByAlphaRoundedIcon"]'),
    ).not.toBeNull();
    expect(sortButton).toHaveAttribute("aria-label", "Sort by name");
  });
});
