import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const vergeState = vi.hoisted(() => ({
  verge: {
    web_ui_list: [
      "https://yacd.metacubex.one/?hostname=%host&port=%port&secret=%secret",
    ],
  },
  patchVerge: vi.fn(),
  mutateVerge: vi.fn(),
}));

const clashInfoMock = vi.hoisted(() => ({
  clashInfo: {
    server: "127.0.0.1:9090",
    secret: "top secret",
  },
}));

const openWebUrlMock = vi.hoisted(() => vi.fn());
const showNoticeMock = vi.hoisted(() => vi.fn());
const webUIItemMock = vi.hoisted(() => vi.fn());

vi.mock("ahooks", () => ({
  useLockFn:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

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
    cancelBtn,
    disableOk,
    onClose,
  }: any) => {
    if (!open) return null;
    return (
      <div data-testid="dialog">
        <div data-testid="dialog-title">{title}</div>
        <div>{children}</div>
        {!disableOk && (
          <button type="button" onClick={onClose}>
            ok
          </button>
        )}
        <button type="button" onClick={onClose}>
          {cancelBtn}
        </button>
      </div>
    );
  };

  const BaseEmpty = ({ extra }: { extra?: React.ReactNode }) => (
    <div data-testid="empty">{extra}</div>
  );

  return {
    BaseDialog,
    BaseEmpty,
    DialogRef: {} as any,
  };
});

vi.mock("@/components/setting/mods/web-ui-item", () => ({
  WebUIItem: (props: any) => {
    webUIItemMock(props);
    const { onlyEdit, value, onChange, onDelete, onOpenUrl, onCancel } = props;
    return (
      <div data-testid={`web-ui-item-${value || "new"}`}>
        <span>{value || "new-entry"}</span>
        <button type="button" onClick={() => onChange?.("changed-entry")}>
          change
        </button>
        <button type="button" onClick={() => onDelete?.()}>
          delete
        </button>
        <button type="button" onClick={() => onOpenUrl?.(value)}>
          open
        </button>
        {onlyEdit && (
          <>
            <button type="button" onClick={() => onChange?.("added-entry")}>
              confirm
            </button>
            <button type="button" onClick={() => onCancel?.()}>
              cancel
            </button>
          </>
        )}
      </div>
    );
  },
}));

vi.mock("@/hooks/use-clash", () => ({
  useClashInfo: () => clashInfoMock,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => vergeState,
}));

vi.mock("@/services/cmds", () => ({
  openWebUrl: (...args: unknown[]) => openWebUrlMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

type DialogHandle = {
  open: () => void;
  close: () => void;
};

let WebUIViewer: typeof import("@/components/setting/mods/web-ui-viewer").WebUIViewer;

const Host = ({ onReady }: { onReady: (handle: DialogHandle) => void }) => {
  const ref = useRef<DialogHandle | null>(null);

  useEffect(() => {
    if (ref.current) {
      onReady(ref.current);
    }
  }, [onReady]);

  return <WebUIViewer ref={ref} />;
};

beforeAll(async () => {
  ({ WebUIViewer } = await import("@/components/setting/mods/web-ui-viewer"));
});

beforeEach(() => {
  vi.clearAllMocks();
  vergeState.verge = {
    web_ui_list: [
      "https://yacd.metacubex.one/?hostname=%host&port=%port&secret=%secret",
    ],
  };
  vergeState.patchVerge.mockResolvedValue(undefined);
  vergeState.mutateVerge.mockImplementation((updater: any) => {
    if (typeof updater === "function") {
      const next = updater(vergeState.verge);
      if (next) {
        vergeState.verge = next;
      }
    } else if (updater) {
      vergeState.verge = updater;
    }
  });
  openWebUrlMock.mockResolvedValue(undefined);
  webUIItemMock.mockClear();
  showNoticeMock.mockReset();
});

const renderViewer = async () => {
  let handle: DialogHandle | null = null;
  render(<Host onReady={(h) => (handle = h)} />);
  await waitFor(() => handle !== null);
  act(() => handle?.open());
  await waitFor(() => expect(screen.getByTestId("dialog")).toBeInTheDocument());
};

describe("WebUIViewer", () => {
  it("lists existing entries and opens editor for new item", async () => {
    await renderViewer();

    expect(webUIItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value:
          "https://yacd.metacubex.one/?hostname=%host&port=%port&secret=%secret",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => {
      const lastCall = webUIItemMock.mock.calls.at(-1)?.[0];
      expect(lastCall?.onlyEdit).toBe(true);
    });
  });

  it("adds new entry via edit component", async () => {
    await renderViewer();

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const editorCall = await waitFor(() => {
      const call = webUIItemMock.mock.calls.at(-1)?.[0];
      expect(call?.onlyEdit).toBe(true);
      return call;
    });

    editorCall.onChange("added-entry");

    expect(vergeState.patchVerge).toHaveBeenCalledWith({
      web_ui_list: [
        "https://yacd.metacubex.one/?hostname=%host&port=%port&secret=%secret",
        "added-entry",
      ],
    });
  });

  it("updates and deletes existing entries", async () => {
    await renderViewer();

    const firstCall = webUIItemMock.mock.calls.find(
      (args) => !args[0].onlyEdit,
    )?.[0];
    expect(firstCall).toBeDefined();

    firstCall.onChange("changed-entry");
    expect(vergeState.patchVerge).toHaveBeenCalledWith({
      web_ui_list: ["changed-entry"],
    });

    firstCall.onDelete();
    expect(vergeState.patchVerge).toHaveBeenCalledWith({
      web_ui_list: [],
    });
  });

  it("opens web ui url with replacements and handles failure", async () => {
    await renderViewer();

    const firstCall = webUIItemMock.mock.calls.find(
      (args) => !args[0].onlyEdit,
    )?.[0];
    expect(firstCall).toBeDefined();

    await firstCall.onOpenUrl?.(
      "https://example.com?host=%host&port=%port&secret=%secret",
    );

    expect(openWebUrlMock).toHaveBeenCalledWith(
      "https://example.com?host=127.0.0.1&port=9090&secret=top%20secret",
    );

    openWebUrlMock.mockRejectedValueOnce(new Error("open failed"));
    await firstCall.onOpenUrl?.("https://example.com?port=%port");
    expect(showNoticeMock).toHaveBeenCalledWith("error", "open failed");
  });

  it("shows notice when clash info missing for placeholder replacements", async () => {
    clashInfoMock.clashInfo = null as any;
    await renderViewer();

    const firstCall = webUIItemMock.mock.calls.find(
      (args) => !args[0].onlyEdit,
    )?.[0];
    expect(firstCall).toBeDefined();

    await firstCall.onOpenUrl?.("https://example.com?port=%port");
    expect(showNoticeMock).toHaveBeenCalledWith(
      "error",
      "failed to get clash info",
    );
  });
});
