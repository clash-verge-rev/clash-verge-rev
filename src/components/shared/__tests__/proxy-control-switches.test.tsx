import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProxyControlSwitches from "../ProxyControlSwitches";

const {
  useVergeMock,
  useSystemProxyStateMock,
  useSystemStateMock,
  toggleSystemProxyMock,
  installServiceMock,
  uninstallServiceMock,
  mutateRunningModeMock,
  mutateServiceOkMock,
  mutateTunModeAvailableMock,
  showNoticeMock,
} = vi.hoisted(() => ({
  useVergeMock: vi.fn(),
  useSystemProxyStateMock: vi.fn(),
  useSystemStateMock: vi.fn(),
  toggleSystemProxyMock: vi.fn(),
  installServiceMock: vi.fn(),
  uninstallServiceMock: vi.fn(),
  mutateRunningModeMock: vi.fn(),
  mutateServiceOkMock: vi.fn(),
  mutateTunModeAvailableMock: vi.fn(),
  showNoticeMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("ahooks", () => ({
  useLockFn:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/hooks/use-system-proxy-state", () => ({
  useSystemProxyState: () => useSystemProxyStateMock(),
}));

vi.mock("@/hooks/use-system-state", () => ({
  useSystemState: () => useSystemStateMock(),
}));

vi.mock("@/hooks/useServiceInstaller", () => ({
  useServiceInstaller: () => ({
    installServiceAndRestartCore: installServiceMock,
  }),
}));

vi.mock("@/hooks/useServiceUninstaller", () => ({
  useServiceUninstaller: () => ({
    uninstallServiceAndRestartCore: uninstallServiceMock,
  }),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/components/setting/mods/sysproxy-viewer", () => ({
  SysproxyViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="sysproxy-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/tun-viewer", () => ({
  TunViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="tun-viewer" />;
  }),
}));

describe("ProxyControlSwitches", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    toggleSystemProxyMock.mockResolvedValue(undefined);
    installServiceMock.mockResolvedValue(undefined);
    uninstallServiceMock.mockResolvedValue(undefined);
    mutateRunningModeMock.mockResolvedValue(undefined);
    mutateServiceOkMock.mockResolvedValue(undefined);
    mutateTunModeAvailableMock.mockResolvedValue(undefined);

    useVergeMock.mockReturnValue({
      verge: {
        enable_system_proxy: true,
        enable_tun_mode: false,
      },
      mutateVerge: vi.fn(),
      patchVerge: vi.fn().mockResolvedValue(undefined),
    });

    useSystemProxyStateMock.mockReturnValue({
      actualState: true,
      toggleSystemProxy: toggleSystemProxyMock,
    });

    useSystemStateMock.mockReturnValue({
      isServiceMode: false,
      isTunModeAvailable: true,
      mutateRunningMode: mutateRunningModeMock,
      mutateServiceOk: mutateServiceOkMock,
      mutateTunModeAvailable: mutateTunModeAvailableMock,
    });
  });

  it("renders system proxy switch in active state and toggles via handler", async () => {
    render(<ProxyControlSwitches />);

    expect(screen.getByText("System Proxy")).toBeInTheDocument();
    const switchControl = screen.getByRole("switch");
    expect(switchControl).toBeChecked();

    const user = userEvent.setup();
    await user.click(switchControl);

    expect(toggleSystemProxyMock).toHaveBeenCalledWith(false);
  });

  it("shows tun mode guidance and installs service when requested", async () => {
    useVergeMock.mockReturnValue({
      verge: {
        enable_system_proxy: false,
        enable_tun_mode: false,
      },
      mutateVerge: vi.fn(),
      patchVerge: vi.fn().mockResolvedValue(undefined),
    });

    useSystemStateMock.mockReturnValue({
      isServiceMode: false,
      isTunModeAvailable: false,
      mutateRunningMode: mutateRunningModeMock,
      mutateServiceOk: mutateServiceOkMock,
      mutateTunModeAvailable: mutateTunModeAvailableMock,
    });

    render(<ProxyControlSwitches label="Tun Mode" />);

    expect(screen.getByText("Tun Mode")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "TUN requires Service Mode or Admin Mode",
      }),
    ).toBeInTheDocument();
    const installButton = screen.getByRole("button", {
      name: "Install Service",
    });

    const user = userEvent.setup();
    await user.click(installButton);

    expect(installServiceMock).toHaveBeenCalledTimes(1);
    expect(mutateRunningModeMock).toHaveBeenCalled();
    expect(mutateServiceOkMock).toHaveBeenCalled();
    expect(mutateTunModeAvailableMock).toHaveBeenCalled();
  });

  it("uninstalls service and disables tun mode when requested", async () => {
    const patchVergeMock = vi.fn().mockResolvedValue(undefined);
    const mutateVergeMock = vi.fn();

    useVergeMock.mockReturnValue({
      verge: {
        enable_system_proxy: false,
        enable_tun_mode: true,
      },
      mutateVerge: mutateVergeMock,
      patchVerge: patchVergeMock,
    });

    useSystemStateMock.mockReturnValue({
      isServiceMode: true,
      isTunModeAvailable: true,
      mutateRunningMode: mutateRunningModeMock,
      mutateServiceOk: mutateServiceOkMock,
      mutateTunModeAvailable: mutateTunModeAvailableMock,
    });

    render(<ProxyControlSwitches label="Tun Mode" />);

    const uninstallButton = screen.getByRole("button", {
      name: "Uninstall Service",
    });
    const user = userEvent.setup();
    await user.click(uninstallButton);

    expect(uninstallServiceMock).toHaveBeenCalledTimes(1);
    expect(patchVergeMock).toHaveBeenCalledWith({ enable_tun_mode: false });
    expect(mutateVergeMock).toHaveBeenCalledWith(
      { enable_system_proxy: false, enable_tun_mode: false },
      false,
    );
    expect(mutateRunningModeMock).toHaveBeenCalled();
    expect(mutateServiceOkMock).toHaveBeenCalled();
    expect(mutateTunModeAvailableMock).toHaveBeenCalled();
  });
});
