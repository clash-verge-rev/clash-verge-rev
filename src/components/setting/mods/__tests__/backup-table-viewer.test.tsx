import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

dayjs.extend(relativeTime);

const saveMock = vi.fn();
const showNoticeMock = vi.fn();
const restartAppMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  restartApp: (...args: unknown[]) => restartAppMock(...args),
}));

import { BackupTableViewer } from "../backup-table-viewer";

type BackupTableViewerProps = ComponentProps<typeof BackupTableViewer>;

const createBackupFile = (
  overrides: Partial<BackupTableViewerProps["datasource"][number]> = {},
) => ({
  platform: "windows",
  filename: "windows-2024-01-01_00-00-00",
  allow_apply: true,
  backup_time: dayjs("2024-01-01T08:00:00Z"),
  ...overrides,
});

const renderViewer = (
  props: Partial<BackupTableViewerProps> = {},
  datasource = [createBackupFile()],
) => {
  const defaultProps: BackupTableViewerProps = {
    datasource,
    page: 0,
    total: datasource.length,
    onPageChange: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onRestore: vi.fn().mockResolvedValue(undefined),
    onExport: vi.fn().mockResolvedValue(undefined),
  };

  const merged = { ...defaultProps, ...props };
  return render(<BackupTableViewer {...merged} />);
};

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockReset();
  showNoticeMock.mockReset();
  restartAppMock.mockReset();
});

describe("BackupTableViewer", () => {
  it("exports a backup and shows success notice", async () => {
    const savePath = "C:/backups/archive.yaml";
    saveMock.mockResolvedValueOnce(savePath);
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderViewer({ onExport });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(onExport).toHaveBeenCalledWith(
        "windows-2024-01-01_00-00-00",
        savePath,
      ),
    );
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Local Backup Exported",
    );
  });

  it("does nothing when export dialog is cancelled", async () => {
    saveMock.mockResolvedValueOnce(null);
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderViewer({ onExport });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(onExport).not.toHaveBeenCalled();
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it("deletes a backup after confirmation and refreshes list", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderViewer({ onDelete, onRefresh });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith("windows-2024-01-01_00-00-00"),
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("skips deletion when user cancels confirmation", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderViewer({ onDelete, onRefresh });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("restores a backup and restarts the app on success", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderViewer({ onRestore, onRefresh });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith("windows-2024-01-01_00-00-00"),
    );
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Restore Success, App will restart in 1s",
    );
    expect(restartAppMock).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(0);
    confirmSpy.mockRestore();
  });

  it("shows error notice when export fails", async () => {
    saveMock.mockResolvedValueOnce("C:/backups/archive.yaml");
    const error = new Error("disk full");
    const onExport = vi.fn().mockRejectedValue(error);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    renderViewer({ onExport });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith(
        "error",
        "Local Backup Export Failed",
      ),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    consoleErrorSpy.mockRestore();
  });
});
