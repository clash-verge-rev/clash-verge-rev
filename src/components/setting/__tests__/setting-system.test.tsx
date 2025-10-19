import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingSystem from "@/components/setting/setting-system";

const {
  useVergeMock,
  mutateVergeMock,
  patchVergeMock,
  useSystemStateMock,
  mutateSpy,
  showNoticeMock,
  proxySwitchMock,
} = vi.hoisted(() => ({
  useVergeMock: vi.fn(),
  mutateVergeMock: vi.fn(),
  patchVergeMock: vi.fn(),
  useSystemStateMock: vi.fn(),
  mutateSpy: vi.fn(),
  showNoticeMock: vi.fn(),
  proxySwitchMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/shared/ProxyControlSwitches", () => ({
  __esModule: true,
  default: (props: any) => {
    proxySwitchMock(props);
    return <div data-testid={`proxy-switch-${props.label}`} />;
  },
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

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/hooks/use-system-state", () => ({
  useSystemState: () => useSystemStateMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("swr", () => ({
  mutate: (...args: unknown[]) => mutateSpy(...args),
}));

describe("SettingSystem", () => {
  let vergeState: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();

    vergeState = {
      enable_auto_launch: false,
      enable_silent_start: false,
    };

    mutateVergeMock.mockResolvedValue(undefined);
    patchVergeMock.mockResolvedValue(undefined);

    useVergeMock.mockReturnValue({
      verge: vergeState,
      mutateVerge: mutateVergeMock,
      patchVerge: patchVergeMock,
    });

    useSystemStateMock.mockReturnValue({
      isAdminMode: false,
    });
  });

  it("renders proxy switches and passes labels through", () => {
    render(<SettingSystem />);

    expect(proxySwitchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ label: "Tun Mode" }),
    );
    expect(proxySwitchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ label: "System Proxy" }),
    );
  });

  it("enables auto launch and updates verge config", async () => {
    const user = userEvent.setup();
    render(<SettingSystem />);

    const [autoSwitch] = screen.getAllByRole("switch");
    expect(autoSwitch).not.toBeChecked();

    await user.click(autoSwitch);

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({ enable_auto_launch: true }),
    );

    expect(mutateSpy).toHaveBeenCalledWith("getAutoLaunchStatus");
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it("notifies when toggling auto launch under admin mode", async () => {
    useSystemStateMock.mockReturnValue({ isAdminMode: true });

    const user = userEvent.setup();
    render(<SettingSystem />);

    const [autoSwitch] = screen.getAllByRole("switch");
    await user.click(autoSwitch);

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({ enable_auto_launch: true }),
    );

    expect(showNoticeMock).toHaveBeenCalledWith(
      "info",
      "Administrator mode may not support auto launch",
    );
  });

  it("updates silent start flag via patch", async () => {
    const user = userEvent.setup();
    render(<SettingSystem />);

    const [, silentSwitch] = screen.getAllByRole("switch");
    await user.click(silentSwitch);

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({
        enable_silent_start: true,
      }),
    );
  });
});
