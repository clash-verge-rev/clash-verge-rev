import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingVergeBasic from "@/components/setting/setting-verge-basic";

const {
  useVergeMock,
  mutateVergeMock,
  patchVergeMock,
  showNoticeMock,
  copyClashEnvMock,
  openDialogMock,
  navItemsMock,
} = vi.hoisted(() => ({
  useVergeMock: vi.fn(),
  mutateVergeMock: vi.fn(),
  patchVergeMock: vi.fn(),
  showNoticeMock: vi.fn(),
  copyClashEnvMock: vi.fn(),
  openDialogMock: vi.fn(),
  navItemsMock: [
    { label: "page.home", path: "/" },
    { label: "page.proxies", path: "/proxies" },
  ],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  copyClashEnv: (...args: unknown[]) => copyClashEnvMock(...args),
}));

vi.mock("@/services/i18n", () => ({
  supportedLanguages: ["en", "zh"],
}));

vi.mock("@/pages/_routers", () => ({
  navItems: navItemsMock,
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
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="update-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/backup-viewer", () => ({
  BackupViewer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ open: vi.fn() }));
    return <div data-testid="backup-viewer" />;
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));

describe("SettingVergeBasic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateVergeMock.mockResolvedValue(undefined);
    patchVergeMock.mockResolvedValue(undefined);
    copyClashEnvMock.mockResolvedValue(undefined);
    openDialogMock.mockResolvedValue(undefined);

    useVergeMock.mockReturnValue({
      verge: {
        language: "en",
        theme_mode: "light",
        tray_event: "main_window",
        env_type: "bash",
        start_page: "/",
        startup_script: "",
      },
      mutateVerge: mutateVergeMock,
      patchVerge: patchVergeMock,
    });
  });

  it("renders language selector and updates selection", async () => {
    const user = userEvent.setup();
    render(<SettingVergeBasic />);

    const languageItem = screen.getByText("Language").closest("li");
    expect(languageItem).toBeTruthy();
    const languageSelect = within(languageItem!).getByRole("combobox");
    await user.click(languageSelect);
    await user.click(screen.getByRole("option", { name: "中文" }));

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({ language: "zh" }),
    );
  });

  it("propagates theme mode changes through guard", async () => {
    const user = userEvent.setup();
    render(<SettingVergeBasic />);

    const themeButtons = screen.getAllByRole("button", { name: /theme\./ });
    await user.click(themeButtons[1]);

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({ theme_mode: "dark" }),
    );
  });

  it("copies clash environment and surfaces toast", async () => {
    const user = userEvent.setup();
    render(<SettingVergeBasic />);

    const copyIcon = screen.getByTestId("ContentCopyRoundedIcon");
    const copyIconButton = copyIcon.closest("button");
    expect(copyIconButton).toBeTruthy();
    await user.click(copyIconButton!);

    await waitFor(() => expect(copyClashEnvMock).toHaveBeenCalled());
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Copy Success",
      1000,
    );
  });

  it("updates start page selection with nav items", async () => {
    const user = userEvent.setup();
    render(<SettingVergeBasic />);

    const startPageItem = screen.getByText("Start Page").closest("li");
    expect(startPageItem).toBeTruthy();
    const startPageSelect = within(startPageItem!).getByRole("combobox");
    await user.click(startPageSelect);
    await user.click(screen.getByRole("option", { name: "page.proxies" }));

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({ start_page: "/proxies" }),
    );
  });

  it("opens file picker and patches startup script", async () => {
    openDialogMock.mockResolvedValue("C:/start.ps1");
    const user = userEvent.setup();
    render(<SettingVergeBasic />);

    const browseButton = screen.getByRole("button", { name: "Browse" });
    await user.click(browseButton);

    await waitFor(() => expect(openDialogMock).toHaveBeenCalled());
    expect(patchVergeMock).toHaveBeenCalledWith({
      startup_script: "C:/start.ps1",
    });
  });

  it("clears startup script when Clear is pressed", async () => {
    useVergeMock.mockReturnValue({
      verge: {
        startup_script: "C:/start.ps1",
      },
      mutateVerge: mutateVergeMock,
      patchVerge: patchVergeMock,
    });

    const user = userEvent.setup();
    render(<SettingVergeBasic />);

    const clearButton = screen.getByRole("button", { name: "Clear" });
    await user.click(clearButton);

    expect(patchVergeMock).toHaveBeenCalledWith({ startup_script: "" });
  });
});
