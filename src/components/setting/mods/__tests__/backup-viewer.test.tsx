import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useEffect, useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BackupFile } from "../backup-table-viewer";

const listLocalBackupMock = vi.fn();
const listWebDavBackupMock = vi.fn();
const deleteLocalBackupMock = vi.fn();
const deleteWebdavBackupMock = vi.fn();
const restoreLocalBackupMock = vi.fn();
const restoreWebDavBackupMock = vi.fn();
const exportLocalBackupMock = vi.fn();

let latestBackupTableProps: ComponentProps<
  (typeof import("../backup-table-viewer"))["BackupTableViewer"]
> | null = null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/base", () => {
  const BaseDialog = ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
  }) => {
    if (!open) return null;
    return (
      <div
        data-testid="base-dialog"
        className="MuiPaper-root"
        style={{ border: "1px solid #ccc", padding: 8 }}
      >
        <div data-testid="base-dialog-title">{title}</div>
        <div data-testid="base-dialog-content">{children}</div>
      </div>
    );
  };

  const BaseLoadingOverlay = ({ isLoading }: { isLoading: boolean }) => (
    <div data-testid="loading-overlay">{isLoading ? "loading" : "idle"}</div>
  );

  return {
    BaseDialog,
    BaseLoadingOverlay,
    DialogRef: {} as any,
  };
});

vi.mock("../backup-table-viewer", async () => {
  const actual = await vi.importActual<typeof import("../backup-table-viewer")>(
    "../backup-table-viewer",
  );
  const BackupTableViewerMock = (
    props: ComponentProps<typeof actual.BackupTableViewer>,
  ) => {
    latestBackupTableProps = props;
    return <div data-testid="backup-table-viewer-mock" />;
  };
  return {
    ...actual,
    BackupTableViewer: BackupTableViewerMock,
  };
});

vi.mock("../local-backup-actions", () => ({
  LocalBackupActions: ({
    onRefresh,
  }: {
    onRefresh: () => Promise<void>;
    onBackupSuccess: () => Promise<void>;
    setLoading: (value: boolean) => void;
  }) => (
    <div data-testid="local-backup-actions">
      <button
        type="button"
        onClick={() => {
          void onRefresh();
        }}
      >
        refresh
      </button>
    </div>
  ),
}));

vi.mock("../backup-config-viewer", () => ({
  BackupConfigViewer: () => <div data-testid="backup-config-viewer" />,
}));

vi.mock("@/services/cmds", () => ({
  listLocalBackup: (...args: unknown[]) => listLocalBackupMock(...args),
  listWebDavBackup: (...args: unknown[]) => listWebDavBackupMock(...args),
  deleteLocalBackup: (...args: unknown[]) => deleteLocalBackupMock(...args),
  deleteWebdavBackup: (...args: unknown[]) => deleteWebdavBackupMock(...args),
  restoreLocalBackup: (...args: unknown[]) => restoreLocalBackupMock(...args),
  restoreWebDavBackup: (...args: unknown[]) => restoreWebDavBackupMock(...args),
  exportLocalBackup: (...args: unknown[]) => exportLocalBackupMock(...args),
}));

let BackupViewer: (typeof import("../backup-viewer"))["BackupViewer"];

beforeAll(async () => {
  ({ BackupViewer } = await import("../backup-viewer"));
});

type DialogHandle = { open: () => void; close: () => void };

const Host = ({ onReady }: { onReady: (handle: DialogHandle) => void }) => {
  const ref = useRef<DialogHandle | null>(null);

  useEffect(() => {
    if (ref.current) {
      onReady(ref.current);
    }
  }, [onReady]);

  return <BackupViewer ref={ref} />;
};

const createBackupRecord = (filename: string) => ({ filename });

const extractFilenames = (datasource: BackupFile[]) =>
  datasource.map((file) => file.filename);

beforeEach(() => {
  vi.clearAllMocks();
  latestBackupTableProps = null;
  listLocalBackupMock.mockResolvedValue([
    createBackupRecord("windows-2024-03-05_10-00-00"),
    createBackupRecord("linux-2024-03-06_11-00-00"),
  ]);
  listWebDavBackupMock.mockResolvedValue([
    createBackupRecord("mac-2024-02-01_09-00-00"),
  ]);
  deleteLocalBackupMock.mockResolvedValue(undefined);
  deleteWebdavBackupMock.mockResolvedValue(undefined);
  restoreLocalBackupMock.mockResolvedValue(undefined);
  restoreWebDavBackupMock.mockResolvedValue(undefined);
  exportLocalBackupMock.mockResolvedValue(undefined);
});

const openViewer = async () => {
  let handle: DialogHandle | null = null;
  render(<Host onReady={(next) => (handle = next)} />);
  await waitFor(() => expect(handle).not.toBeNull());
  await act(async () => {
    handle?.open();
  });
  await waitFor(() => expect(screen.getByTestId("base-dialog")).toBeVisible());
  await waitFor(() => expect(latestBackupTableProps?.datasource).toBeDefined());
};

describe("BackupViewer", () => {
  it("opens via handle and loads local backup records sorted by time", async () => {
    await openViewer();

    await waitFor(() => expect(listLocalBackupMock).toHaveBeenCalledTimes(1));

    const datasource = latestBackupTableProps?.datasource;
    expect(datasource).toBeDefined();
    expect(extractFilenames(datasource!)).toEqual([
      "linux-2024-03-06_11-00-00",
      "windows-2024-03-05_10-00-00",
    ]);
    expect(latestBackupTableProps?.onExport).toBeTypeOf("function");
  });

  it("switches to WebDAV source and disables export", async () => {
    await openViewer();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "WebDAV Backup" }));

    await waitFor(() => expect(listWebDavBackupMock).toHaveBeenCalledTimes(1));
    const datasource = latestBackupTableProps?.datasource ?? [];
    expect(extractFilenames(datasource)).toEqual(["mac-2024-02-01_09-00-00"]);
    expect(latestBackupTableProps?.onExport).toBeUndefined();
  });

  it("invokes local delete, restore, and export handlers", async () => {
    await openViewer();
    const props = latestBackupTableProps;
    expect(props).toBeDefined();
    const firstFilename = props?.datasource?.[0].filename ?? "";

    await props?.onDelete(firstFilename);
    expect(deleteLocalBackupMock).toHaveBeenCalledWith(firstFilename);

    await props?.onRestore(firstFilename);
    expect(restoreLocalBackupMock).toHaveBeenCalledWith(firstFilename);

    await props?.onExport?.(firstFilename, "C:/tmp/backup.yaml");
    expect(exportLocalBackupMock).toHaveBeenCalledWith(
      firstFilename,
      "C:/tmp/backup.yaml",
    );
  });

  it("invokes WebDAV delete and restore after switching source", async () => {
    await openViewer();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "WebDAV Backup" }));
    await waitFor(() => expect(listWebDavBackupMock).toHaveBeenCalledTimes(1));

    const props = latestBackupTableProps;
    expect(props).toBeDefined();
    const filename = props?.datasource?.[0].filename ?? "";

    await props?.onDelete(filename);
    expect(deleteWebdavBackupMock).toHaveBeenCalledWith(filename);

    await props?.onRestore(filename);
    expect(restoreWebDavBackupMock).toHaveBeenCalledWith(filename);
  });
});
