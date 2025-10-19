import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { editorViewerSpy } = vi.hoisted(() => ({
  editorViewerSpy: vi.fn(
    (props: {
      open: boolean;
      onSave?: (prev?: string, curr?: string) => Promise<void> | void;
      onClose: () => void;
    }) => {
      if (!props.open) return null;
      return (
        <div data-testid="editor-viewer">
          <button
            type="button"
            onClick={async () => {
              await props.onSave?.("prev", "curr");
              props.onClose();
            }}
          >
            save changes
          </button>
          <button type="button" onClick={props.onClose}>
            close editor
          </button>
        </div>
      );
    },
  ),
}));

vi.mock("@/components/profile/editor-viewer", () => ({
  EditorViewer: editorViewerSpy,
}));

const { logViewerSpy } = vi.hoisted(() => ({
  logViewerSpy: vi.fn(
    (props: {
      open: boolean;
      onClose: () => void;
      logInfo?: [string, string][];
    }) =>
      props.open ? (
        <div data-testid="log-viewer">
          <span>logs: {props.logInfo?.length ?? 0}</span>
          <button type="button" onClick={props.onClose}>
            close log
          </button>
        </div>
      ) : null,
  ),
}));

vi.mock("@/components/profile/log-viewer", () => ({
  LogViewer: logViewerSpy,
}));

vi.mock("@/services/cmds", () => ({
  viewProfile: vi.fn(),
  readProfileFile: vi.fn(),
  saveProfileFile: vi.fn(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: vi.fn(),
}));

import { ProfileMore } from "@/components/profile/profile-more";
import { viewProfile, readProfileFile, saveProfileFile } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

const viewProfileMock = vi.mocked(viewProfile);
const readProfileFileMock = vi.mocked(readProfileFile);
const saveProfileFileMock = vi.mocked(saveProfileFile);
const showNoticeMock = vi.mocked(showNotice);

describe("ProfileMore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewProfileMock.mockResolvedValue(undefined);
    readProfileFileMock.mockResolvedValue("initial file");
    saveProfileFileMock.mockResolvedValue(undefined);
  });

  it("opens editor on double click and persists changes", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();

    render(<ProfileMore id="Script" logInfo={[]} onSave={onSave} />);

    await user.dblClick(screen.getByRole("heading", { name: "Global Script" }));

    expect(editorViewerSpy).toHaveBeenCalledTimes(1);
    expect(readProfileFileMock).toHaveBeenCalledWith("Script");
    expect(
      screen.getByTestId("editor-viewer"),
      "editor should render when open",
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "save changes" }));

    await waitFor(() => {
      expect(saveProfileFileMock).toHaveBeenCalledWith("Script", "curr");
    });
    expect(onSave).toHaveBeenCalledWith("prev", "curr");
    await waitFor(() => {
      expect(screen.queryByTestId("editor-viewer")).not.toBeInTheDocument();
    });
  });

  it("opens context menu and invokes viewProfile", async () => {
    const user = userEvent.setup();

    render(<ProfileMore id="Merge" logInfo={[]} />);

    const heading = screen.getByRole("heading", { name: "Global Merge" });
    await user.pointer({ keys: "[MouseRight]", target: heading });

    const openFileItem = await screen.findByText("Open File");
    await user.click(openFileItem);

    await waitFor(() => {
      expect(viewProfileMock).toHaveBeenCalledWith("Merge");
    });
    expect(showNoticeMock).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Script Console")).toBeNull();
  });

  it("shows error notice when viewProfile fails", async () => {
    const user = userEvent.setup();
    viewProfileMock.mockRejectedValueOnce(new Error("boom"));

    render(<ProfileMore id="Script" logInfo={[]} />);

    const heading = screen.getByRole("heading", { name: "Global Script" });
    await user.pointer({ keys: "[MouseRight]", target: heading });
    const openFileItem = await screen.findByText("Open File");
    await user.click(openFileItem);

    await waitFor(() => {
      expect(showNoticeMock).toHaveBeenCalledWith("error", "boom");
    });
  });

  it("renders log viewer when script entries contain exceptions", async () => {
    const user = userEvent.setup();
    const logInfo: [string, string][] = [
      ["exception", "some error"],
      ["info", "other"],
    ];

    render(<ProfileMore id="Script" logInfo={logInfo} />);

    const consoleButton = screen.getByTitle("Script Console");
    await user.click(consoleButton);

    const lastCall = logViewerSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({ open: true, logInfo });
    expect(screen.getByTestId("log-viewer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "close log" }));

    await waitFor(() => {
      expect(screen.queryByTestId("log-viewer")).not.toBeInTheDocument();
    });
  });
});
