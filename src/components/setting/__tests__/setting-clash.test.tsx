import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingClash from "@/components/setting/setting-clash";

const {
  useClashMock,
  mutateClashMock,
  patchClashMock,
  useVergeMock,
  patchVergeMock,
  useClashLogMock,
  setClashLogMock,
  showNoticeMock,
  updateGeoMock,
  invokeMock,
} = vi.hoisted(() => ({
  useClashMock: vi.fn(),
  mutateClashMock: vi.fn(),
  patchClashMock: vi.fn(),
  useVergeMock: vi.fn(),
  patchVergeMock: vi.fn(),
  useClashLogMock: vi.fn(),
  setClashLogMock: vi.fn(),
  showNoticeMock: vi.fn(),
  updateGeoMock: vi.fn(),
  invokeMock: vi.fn(),
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

vi.mock("@/components/base/base-tooltip-icon", () => ({
  TooltipIcon: ({
    title,
    onClick,
  }: {
    title?: string;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick ?? (() => undefined)}>
      {title ?? "icon"}
    </button>
  ),
}));

vi.mock("@/components/setting/mods/network-interface-viewer", () => ({
  NetworkInterfaceViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="network-interface-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/dns-viewer", () => ({
  DnsViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="dns-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/clash-port-viewer", () => ({
  ClashPortViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="clash-port-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/controller-viewer", () => ({
  ControllerViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="controller-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/clash-core-viewer", () => ({
  ClashCoreViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="clash-core-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/web-ui-viewer", () => ({
  WebUIViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="web-ui-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/external-controller-cors", () => ({
  HeaderConfiguration: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="header-configuration" />;
  }),
}));

vi.mock("@/hooks/use-clash", () => ({
  useClash: () => useClashMock(),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/services/states", () => ({
  useClashLog: () => useClashLogMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  updateGeo: (...args: unknown[]) => updateGeoMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  invoke_uwp_tool: vi.fn(),
}));

describe("SettingClash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateClashMock.mockResolvedValue(undefined);
    patchClashMock.mockResolvedValue(undefined);
    patchVergeMock.mockResolvedValue(undefined);
    updateGeoMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(undefined);
    setClashLogMock.mockImplementation((updater: any) => updater({}));

    useClashMock.mockReturnValue({
      clash: {
        "allow-lan": true,
        ipv6: false,
        "log-level": "info",
        "unified-delay": false,
      },
      version: "2024.01",
      mutateClash: mutateClashMock,
      patchClash: patchClashMock,
    });

    useVergeMock.mockReturnValue({
      verge: {
        verge_mixed_port: 7897,
        enable_dns_settings: false,
      },
      patchVerge: patchVergeMock,
    });

    useClashLogMock.mockReturnValue([{}, setClashLogMock]);
    showNoticeMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toggles Allow Lan and syncs config", async () => {
    const user = userEvent.setup();
    render(<SettingClash onError={vi.fn()} />);

    const allowItem = screen.getByText("Allow Lan").closest("li");
    expect(allowItem).toBeTruthy();
    const allowSwitch = within(allowItem!).getByRole("switch");
    expect(allowSwitch).toBeChecked();

    await user.click(allowSwitch);

    expect(mutateClashMock).toHaveBeenCalled();
    expect(patchClashMock).toHaveBeenCalledWith({ "allow-lan": false });
  });

  it("enables DNS overwrite and applies config", async () => {
    const user = userEvent.setup();
    render(<SettingClash onError={vi.fn()} />);

    const dnsItem = screen.getByText("DNS Overwrite").closest("li");
    expect(dnsItem).toBeTruthy();
    const dnsSwitch = within(dnsItem!).getByRole("switch");
    expect(dnsSwitch).not.toBeChecked();

    const mutateCallsBefore = mutateClashMock.mock.calls.length;

    await user.click(dnsSwitch);

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({
        enable_dns_settings: true,
      }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("apply_dns_config", {
        apply: true,
      }),
    );
    await waitFor(() =>
      expect(mutateClashMock).toHaveBeenCalledTimes(mutateCallsBefore + 1),
    );
    expect(localStorage.getItem("dns_settings_enabled")).toBe("true");
  });

  it("reverts DNS overwrite and surfaces errors on failure", async () => {
    const user = userEvent.setup();
    patchVergeMock
      .mockRejectedValueOnce(new Error("patch failed"))
      .mockResolvedValueOnce(undefined);

    const rejectionHandler = vi.fn();
    const processHandler = (reason: unknown) => {
      rejectionHandler(reason);
    };
    process.on("unhandledRejection", processHandler);

    render(<SettingClash onError={vi.fn()} />);

    const dnsItem = screen.getByText("DNS Overwrite").closest("li");
    expect(dnsItem).toBeTruthy();
    const dnsSwitch = within(dnsItem!).getByRole("switch");

    await user.click(dnsSwitch).catch(() => {});

    expect(showNoticeMock).toHaveBeenCalledWith("error", "patch failed");
    expect(localStorage.getItem("dns_settings_enabled")).toBe("false");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(mutateClashMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(within(dnsItem!).getByRole("switch")).not.toBeChecked(),
    );
    process.off("unhandledRejection", processHandler);
    expect(rejectionHandler).toHaveBeenCalled();
  });

  it("shows success notice after updating geodata", async () => {
    const user = userEvent.setup();
    render(<SettingClash onError={vi.fn()} />);

    await user.click(screen.getByText("Update GeoData"));

    expect(updateGeoMock).toHaveBeenCalled();
    expect(showNoticeMock).toHaveBeenCalledWith("success", "GeoData Updated");
  });

  it("surfaces update geo errors from service", async () => {
    updateGeoMock.mockRejectedValueOnce({
      response: { data: { message: "boom" } },
    });
    const user = userEvent.setup();
    render(<SettingClash onError={vi.fn()} />);

    await user.click(screen.getByText("Update GeoData"));

    expect(showNoticeMock).toHaveBeenCalledWith("error", "boom");
  });

  it("updates log level selection and syncs clash log state", async () => {
    const user = userEvent.setup();
    render(<SettingClash onError={vi.fn()} />);

    const logItem = screen.getByText("Log Level").closest("li");
    expect(logItem).toBeTruthy();
    const logSelect = within(logItem!).getByRole("combobox");

    await user.click(logSelect);
    await user.click(screen.getByRole("option", { name: "Warn" }));

    await waitFor(() =>
      expect(patchClashMock).toHaveBeenCalledWith({ "log-level": "warning" }),
    );
    expect(setClashLogMock).toHaveBeenCalled();
  });
});
