import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const addListenerMock = vi.fn();
const relaunchMock = vi.fn();
const downloadAndInstallMock = vi.fn();
const openReleaseMock = vi.fn();
const showNoticeMock = vi.fn();
const useUpdateStateMock = vi.fn();
const setUpdateStateMock = vi.fn();
const useSWRMock = vi.fn();

type DialogHandle = {
  open: () => void;
  close: () => void;
};

let portableFlagValue = false;

vi.mock("ahooks", () => ({
  useLockFn:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("@/components/base", () => {
  const BaseDialog = ({
    open,
    title,
    children,
    okBtn,
    cancelBtn,
    onOk,
    onCancel,
  }: any) => {
    if (!open) return null;
    return (
      <div data-testid="dialog">
        <div data-testid="dialog-title">{title}</div>
        <div>{children}</div>
        <button type="button" onClick={onOk}>
          {okBtn}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelBtn}
        </button>
      </div>
    );
  };

  return {
    BaseDialog,
    DialogRef: {} as any,
  };
});

vi.mock("@/hooks/use-listen", () => ({
  useListen: () => ({ addListener: addListenerMock }),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/services/states", () => ({
  useUpdateState: () => useUpdateStateMock(),
  useSetUpdateState: () => setUpdateStateMock,
}));

vi.mock("@/services/update", () => ({
  checkUpdateSafe: vi.fn(),
}));

vi.mock("@/pages/_layout", () => ({
  get portableFlag() {
    return portableFlagValue;
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => openReleaseMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({}));

vi.mock("swr", () => ({
  default: useSWRMock,
}));

let UpdateViewer: typeof import("@/components/setting/mods/update-viewer").UpdateViewer;

const Host = ({ onReady }: { onReady: (handle: DialogHandle) => void }) => {
  const ref = useRef<DialogHandle | null>(null);

  useEffect(() => {
    if (ref.current) {
      onReady(ref.current);
    }
  }, [onReady]);

  return <UpdateViewer ref={ref} />;
};

beforeAll(async () => {
  ({ UpdateViewer } = await import("@/components/setting/mods/update-viewer"));
});

const updateInfo = {
  version: "3.2.1",
  body: "Changelog",
  downloadAndInstall: downloadAndInstallMock,
};

beforeEach(() => {
  vi.clearAllMocks();
  portableFlagValue = false;
  addListenerMock.mockReset().mockResolvedValue(vi.fn());
  openReleaseMock.mockResolvedValue(undefined);
  downloadAndInstallMock.mockResolvedValue(undefined);
  useUpdateStateMock.mockReturnValue(false);
  setUpdateStateMock.mockReset();
  useSWRMock.mockReturnValue({ data: updateInfo });
});

const renderViewer = async () => {
  let handle: DialogHandle | null = null;
  render(<Host onReady={(h) => (handle = h)} />);
  await waitFor(() => handle !== null);
  act(() => handle?.open());
  await waitFor(() => expect(screen.getByTestId("dialog")).toBeInTheDocument());
};

describe("UpdateViewer", () => {
  it("opens release page for the selected version", async () => {
    await renderViewer();

    await userEvent.click(
      screen.getByRole("button", { name: "Go to Release Page" }),
    );

    expect(openReleaseMock).toHaveBeenCalledWith(
      "https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v3.2.1",
    );
  });

  it("blocks update when running in portable mode", async () => {
    portableFlagValue = true;
    await renderViewer();

    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(showNoticeMock).toHaveBeenCalledWith(
      "error",
      "Portable Updater Error",
    );
    expect(addListenerMock).not.toHaveBeenCalled();
    expect(downloadAndInstallMock).not.toHaveBeenCalled();
  });

  it("prevents update when changelog contains break change notice", async () => {
    useSWRMock.mockReturnValue({
      data: { ...updateInfo, body: "Important Break Change details" },
    });

    await renderViewer();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(showNoticeMock).toHaveBeenCalledWith(
      "error",
      "Break Change Update Error",
    );
    expect(setUpdateStateMock).not.toHaveBeenCalledWith(true);
  });

  it("downloads update, listens to progress, and relaunches", async () => {
    const unlistenMock = vi.fn();
    addListenerMock.mockResolvedValueOnce(unlistenMock);

    await renderViewer();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(setUpdateStateMock).toHaveBeenCalledWith(true));
    expect(addListenerMock).toHaveBeenCalledWith(
      "tauri://update-download-progress",
      expect.any(Function),
    );
    await waitFor(() => expect(downloadAndInstallMock).toHaveBeenCalled());
    expect(relaunchMock).toHaveBeenCalled();
    expect(unlistenMock).toHaveBeenCalled();
    expect(setUpdateStateMock).toHaveBeenLastCalledWith(false);
  });

  it("shows error when update download fails", async () => {
    downloadAndInstallMock.mockRejectedValueOnce(new Error("fail"));
    const unlistenMock = vi.fn();
    addListenerMock.mockResolvedValueOnce(unlistenMock);

    await renderViewer();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith("error", "fail"),
    );
    expect(unlistenMock).toHaveBeenCalled();
    expect(setUpdateStateMock).toHaveBeenLastCalledWith(false);
  });
});
