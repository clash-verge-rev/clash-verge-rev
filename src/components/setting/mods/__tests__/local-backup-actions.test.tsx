import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createLocalBackupMock = vi.fn();
const showNoticeMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/services/cmds", () => ({
  createLocalBackup: (...args: unknown[]) => createLocalBackupMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

import { LocalBackupActions } from "../local-backup-actions";

beforeEach(() => {
  vi.clearAllMocks();
  createLocalBackupMock.mockReset();
  showNoticeMock.mockReset();
});

describe("LocalBackupActions", () => {
  it("creates a local backup and notifies on success", async () => {
    const setLoading = vi.fn();
    const onBackupSuccess = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    createLocalBackupMock.mockResolvedValueOnce(undefined);

    render(
      <LocalBackupActions
        onBackupSuccess={onBackupSuccess}
        onRefresh={onRefresh}
        setLoading={setLoading}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Backup" }));

    await waitFor(() => expect(createLocalBackupMock).toHaveBeenCalled());
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Local Backup Created",
    );
    expect(onBackupSuccess).toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledTimes(2);
    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("shows error notice when backup creation fails", async () => {
    const setLoading = vi.fn();
    const onBackupSuccess = vi.fn();
    const onRefresh = vi.fn();
    const error = new Error("write failed");
    createLocalBackupMock.mockRejectedValueOnce(error);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <LocalBackupActions
        onBackupSuccess={onBackupSuccess}
        onRefresh={onRefresh}
        setLoading={setLoading}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Backup" }));

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith(
        "error",
        "Local Backup Failed",
      ),
    );
    expect(onBackupSuccess).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    consoleErrorSpy.mockRestore();
  });

  it("refreshes the list and toggles loading state", async () => {
    const setLoading = vi.fn();
    const onBackupSuccess = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <LocalBackupActions
        onBackupSuccess={onBackupSuccess}
        onRefresh={onRefresh}
        setLoading={setLoading}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(setLoading).toHaveBeenCalledTimes(2);
    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });
});
