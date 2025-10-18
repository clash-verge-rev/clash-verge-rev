import { ThemeProvider, createTheme } from "@mui/material/styles";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProxyTunCard } from "@/components/home/proxy-tun-card";

const storageKey = "clash-verge-proxy-active-tab";

const switchPropsMock = vi.hoisted(() => vi.fn());
const showNoticeMock = vi.hoisted(() => vi.fn());

const systemProxyState = vi.hoisted(() => ({
  actualState: false,
  toggleSystemProxy: vi.fn(),
}));

const systemState = vi.hoisted(() => ({
  isTunModeAvailable: true,
}));

const vergeState = vi.hoisted(() => ({
  verge: { enable_tun_mode: false },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/shared/ProxyControlSwitches", () => ({
  __esModule: true,
  default: (props: any) => {
    switchPropsMock(props);
    return (
      <div data-testid="proxy-switches" data-label={props.label}>
        {props.label}
      </div>
    );
  },
}));

vi.mock("@/hooks/use-system-proxy-state", () => ({
  useSystemProxyState: () => systemProxyState,
}));

vi.mock("@/hooks/use-system-state", () => ({
  useSystemState: () => systemState,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => vergeState,
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: showNoticeMock,
}));

const renderWithTheme = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <ProxyTunCard />
    </ThemeProvider>,
  );

describe("ProxyTunCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    systemProxyState.actualState = false;
    systemState.isTunModeAvailable = true;
    vergeState.verge = { enable_tun_mode: false };
  });

  it("reads system tab state and shows proxy description", () => {
    localStorage.setItem(storageKey, "system");
    systemProxyState.actualState = true;

    renderWithTheme();

    expect(screen.getByText("System Proxy Enabled")).toBeInTheDocument();
    expect(screen.getByTestId("proxy-switches")).toHaveAttribute(
      "data-label",
      "System Proxy",
    );
  });

  it("switches to tun tab, persists choice, and updates description", () => {
    localStorage.setItem(storageKey, "system");
    systemState.isTunModeAvailable = true;
    vergeState.verge = { enable_tun_mode: true };

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderWithTheme();

    fireEvent.click(screen.getAllByText("Tun Mode")[0]);

    expect(setItemSpy).toHaveBeenCalledWith(storageKey, "tun");
    expect(screen.getByText("TUN Mode Enabled")).toBeInTheDocument();
    expect(screen.getByTestId("proxy-switches")).toHaveAttribute(
      "data-label",
      "Tun Mode",
    );

    setItemSpy.mockRestore();
  });

  it("notifies when TUN is unavailable and onError is triggered", () => {
    systemState.isTunModeAvailable = false;

    renderWithTheme();

    fireEvent.click(screen.getAllByText("Tun Mode")[0]);
    expect(screen.getByText("TUN Mode Service Required")).toBeInTheDocument();

    const lastCall = switchPropsMock.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    lastCall?.onError?.(new Error("oops"));

    expect(showNoticeMock).toHaveBeenCalledWith("error", "oops");
  });
});
