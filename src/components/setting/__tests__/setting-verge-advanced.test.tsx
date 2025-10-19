import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingVergeAdvanced from "@/components/setting/setting-verge-advanced";

const {
  showNoticeMock,
  checkUpdateMock,
  exportDiagnosticInfoMock,
  openAppDirMock,
  openDevToolsMock,
  openLogsDirMock,
  openCoreDirMock,
  exitAppMock,
  updateViewerOpenMock,
} = vi.hoisted(() => ({
  showNoticeMock: vi.fn(),
  checkUpdateMock: vi.fn(),
  exportDiagnosticInfoMock: vi.fn(),
  openAppDirMock: vi.fn(),
  openDevToolsMock: vi.fn(),
  openLogsDirMock: vi.fn(),
  openCoreDirMock: vi.fn(),
  exitAppMock: vi.fn(),
  updateViewerOpenMock: vi.fn(),
}));

const clipboardWriteMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/services/update", () => ({
  checkUpdateSafe: (...args: unknown[]) => checkUpdateMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  exportDiagnosticInfo: (...args: unknown[]) =>
    exportDiagnosticInfoMock(...args),
  openAppDir: (...args: unknown[]) => openAppDirMock(...args),
  openCoreDir: (...args: unknown[]) => openCoreDirMock(...args),
  openLogsDir: (...args: unknown[]) => openLogsDirMock(...args),
  openDevTools: (...args: unknown[]) => openDevToolsMock(...args),
  exitApp: (...args: unknown[]) => exitAppMock(...args),
}));

vi.mock("@/components/base/base-tooltip-icon", () => ({
  TooltipIcon: ({
    title,
    onClick,
  }: {
    title?: string;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {title ?? "icon"}
    </button>
  ),
}));

vi.mock("@/components/setting/mods/theme-viewer", () => ({
  ThemeViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="theme-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/config-viewer", () => ({
  ConfigViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="config-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/hotkey-viewer", () => ({
  HotkeyViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="hotkey-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/misc-viewer", () => ({
  MiscViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="misc-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/layout-viewer", () => ({
  LayoutViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="layout-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/update-viewer", () => ({
  UpdateViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: updateViewerOpenMock }));
    return <div data-testid="update-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/backup-viewer", () => ({
  BackupViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="backup-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/lite-mode-viewer", () => ({
  LiteModeViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="lite-mode-viewer" />;
  }),
}));

describe("SettingVergeAdvanced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteMock },
      configurable: true,
    });
    clipboardWriteMock.mockReset();
    clipboardWriteMock.mockResolvedValue(undefined);
    checkUpdateMock.mockResolvedValue({ available: false });
    exportDiagnosticInfoMock.mockResolvedValue(undefined);
  });

  it("shows version text and copies version to clipboard", async () => {
    const user = userEvent.setup();
    render(<SettingVergeAdvanced />);

    expect(screen.getByText(/Verge Version/i)).toBeInTheDocument();
    const versionItem = screen.getByText("Verge Version").closest("li");
    expect(versionItem).toBeTruthy();
    const versionCopyButton = within(versionItem!).getByRole("button");

    await user.click(versionCopyButton);

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith(
        "success",
        "Version copied to clipboard",
        1000,
      ),
    );
  });

  it("exports diagnostic info via toolbar action", async () => {
    const user = userEvent.setup();
    render(<SettingVergeAdvanced />);

    const exportItem = screen.getByText("Export Diagnostic Info").closest("li");
    expect(exportItem).toBeTruthy();
    const exportButton = within(exportItem!).getByRole("button");

    await user.click(exportButton);

    expect(exportDiagnosticInfoMock).toHaveBeenCalled();
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Copy Success",
      1000,
    );
  });

  it("checks updates and informs when none available", async () => {
    const user = userEvent.setup();
    render(<SettingVergeAdvanced />);

    await user.click(screen.getByText("Check for Updates"));

    expect(checkUpdateMock).toHaveBeenCalled();
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Currently on the Latest Version",
    );
  });

  it("opens update dialog when a new version is available", async () => {
    checkUpdateMock.mockResolvedValueOnce({ available: true });
    const user = userEvent.setup();
    render(<SettingVergeAdvanced />);

    await user.click(screen.getByText("Check for Updates"));

    expect(updateViewerOpenMock).toHaveBeenCalled();
  });

  it("invokes directory and exit actions on click", async () => {
    const user = userEvent.setup();
    render(<SettingVergeAdvanced />);

    await user.click(screen.getByText("Open Conf Dir"));
    await user.click(screen.getByText("Open Core Dir"));
    await user.click(screen.getByText("Open Logs Dir"));
    await user.click(screen.getByText("Open Dev Tools"));
    await user.click(screen.getByText("Exit"));

    expect(openAppDirMock).toHaveBeenCalled();
    expect(openCoreDirMock).toHaveBeenCalled();
    expect(openLogsDirMock).toHaveBeenCalled();
    expect(openDevToolsMock).toHaveBeenCalled();
    expect(exitAppMock).toHaveBeenCalled();
  });
});
