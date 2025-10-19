import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createWebdavBackupMock = vi.fn();
const saveWebdavConfigMock = vi.fn();
const showNoticeMock = vi.fn();
const useVergeMock = vi.fn();
const isValidUrlMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/services/cmds", () => ({
  createWebdavBackup: (...args: unknown[]) => createWebdavBackupMock(...args),
  saveWebdavConfig: (...args: unknown[]) => saveWebdavConfigMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/utils/helper", () => ({
  isValidUrl: (...args: unknown[]) => isValidUrlMock(...args),
}));

import { BackupConfigViewer } from "../backup-config-viewer";

const defaultConfig = {
  webdav_url: "https://example.com/storage",
  webdav_username: "alice",
  webdav_password: "secret",
};

const renderViewer = () => {
  const onBackupSuccess = vi.fn().mockResolvedValue(undefined);
  const onSaveSuccess = vi.fn().mockResolvedValue(undefined);
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const onInit = vi.fn().mockResolvedValue(undefined);
  const setLoading = vi.fn();

  render(
    <BackupConfigViewer
      onBackupSuccess={onBackupSuccess}
      onSaveSuccess={onSaveSuccess}
      onRefresh={onRefresh}
      onInit={onInit}
      setLoading={setLoading}
    />,
  );

  return {
    onBackupSuccess,
    onSaveSuccess,
    onRefresh,
    onInit,
    setLoading,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  createWebdavBackupMock.mockReset();
  saveWebdavConfigMock.mockReset();
  showNoticeMock.mockReset();
  useVergeMock.mockReset();
  isValidUrlMock.mockReset();
  isValidUrlMock.mockReturnValue(true);
  useVergeMock.mockReturnValue({ verge: { ...defaultConfig } });
});

describe("BackupConfigViewer", () => {
  it("initializes when WebDAV config exists and performs backups", async () => {
    createWebdavBackupMock.mockResolvedValueOnce(undefined);
    const { onBackupSuccess, onInit, setLoading } = renderViewer();
    await waitFor(() => expect(onInit).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Backup" }));

    await waitFor(() => expect(createWebdavBackupMock).toHaveBeenCalled());
    expect(showNoticeMock).toHaveBeenCalledWith("success", "Backup Created");
    expect(onBackupSuccess).toHaveBeenCalled();
    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("switches to save mode when form changes and persists configuration", async () => {
    saveWebdavConfigMock.mockResolvedValueOnce(undefined);
    const { onSaveSuccess, onRefresh, setLoading } = renderViewer();
    const user = userEvent.setup();
    const urlInput = screen.getByLabelText(
      "WebDAV Server URL",
    ) as HTMLInputElement;

    await user.clear(urlInput);
    await user.type(urlInput, "https://new.example.com/storage");

    const saveButton = await screen.findByRole("button", { name: "Save" });
    await user.click(saveButton);

    await waitFor(() =>
      expect(saveWebdavConfigMock).toHaveBeenCalledWith(
        "https://new.example.com/storage",
        "alice",
        "secret",
      ),
    );
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "WebDAV Config Saved",
    );
    expect(onSaveSuccess).toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("validates WebDAV URL format before saving", async () => {
    isValidUrlMock.mockImplementation(() => false);
    const { setLoading } = renderViewer();
    const user = userEvent.setup();
    const urlInput = screen.getByLabelText(
      "WebDAV Server URL",
    ) as HTMLInputElement;

    await user.clear(urlInput);
    await user.type(urlInput, "notaurl");

    const saveButton = await screen.findByRole("button", { name: "Save" });
    const rejections: unknown[] = [];
    const handler = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", handler);

    try {
      await user.click(saveButton);

      await waitFor(() =>
        expect(showNoticeMock).toHaveBeenCalledWith(
          "error",
          "Invalid WebDAV URL",
        ),
      );
      expect(setLoading).not.toHaveBeenCalled();
      expect(saveWebdavConfigMock).not.toHaveBeenCalled();
      expect(createWebdavBackupMock).not.toHaveBeenCalled();

      await waitFor(() => expect(rejections.length).toBeGreaterThan(0));
      const [first] = rejections;
      expect(first).toBeInstanceOf(Error);
      expect((first as Error).message).toBe("Invalid WebDAV URL");
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});
