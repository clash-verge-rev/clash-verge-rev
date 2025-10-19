import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const vergeState = vi.hoisted(() => ({
  verge: {
    enable_auto_light_weight_mode: false,
    auto_light_weight_minutes: 10,
  },
  patchVerge: vi.fn(),
}));

const entryLiteModeMock = vi.hoisted(() => vi.fn());
const showNoticeMock = vi.hoisted(() => vi.fn());

vi.mock("ahooks", () => ({
  useLockFn:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars?.n !== undefined) {
        return `${key}:${vars.n}`;
      }
      return key;
    },
  }),
}));

vi.mock("@/components/base", () => {
  const Switch = ({
    checked,
    onChange,
  }: {
    checked?: boolean;
    onChange?: (
      event: React.ChangeEvent<HTMLInputElement>,
      value: boolean,
    ) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onChange?.(event, event.target.checked)}
    />
  );

  const BaseDialog = ({
    open,
    title,
    children,
    okBtn,
    cancelBtn,
    onOk,
    onCancel,
    onClose,
  }: any) => {
    if (!open) return null;
    return (
      <div data-testid="dialog">
        <div data-testid="dialog-title">{title}</div>
        <div>{children}</div>
        {okBtn && (
          <button type="button" onClick={onOk}>
            {okBtn}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onCancel?.();
            onClose?.();
          }}
        >
          {cancelBtn}
        </button>
      </div>
    );
  };

  return { BaseDialog, Switch, DialogRef: {} as any };
});

vi.mock("@/components/base/base-tooltip-icon", () => ({
  TooltipIcon: ({ title }: { title?: string }) => (
    <button type="button">{title ?? "tooltip"}</button>
  ),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => vergeState,
}));

vi.mock("@/services/cmds", () => ({
  entry_lightweight_mode: (...args: unknown[]) => entryLiteModeMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

type DialogHandle = {
  open: () => void;
  close: () => void;
};

let LiteModeViewer: typeof import("@/components/setting/mods/lite-mode-viewer").LiteModeViewer;

beforeAll(async () => {
  ({ LiteModeViewer } = await import(
    "@/components/setting/mods/lite-mode-viewer"
  ));
});

const Host = ({ onReady }: { onReady: (handle: DialogHandle) => void }) => {
  const ref = useRef<DialogHandle | null>(null);

  useEffect(() => {
    if (ref.current) {
      onReady(ref.current);
    }
  }, [onReady]);

  return <LiteModeViewer ref={ref} />;
};

beforeEach(() => {
  vi.clearAllMocks();
  vergeState.verge = {
    enable_auto_light_weight_mode: false,
    auto_light_weight_minutes: 10,
  };
  vergeState.patchVerge.mockResolvedValue(undefined);
});

const renderViewer = async () => {
  let handle: DialogHandle | null = null;
  render(<Host onReady={(h) => (handle = h)} />);
  await waitFor(() => handle !== null);
  act(() => handle?.open());
  await waitFor(() => expect(screen.getByTestId("dialog")).toBeInTheDocument());
};

describe("LiteModeViewer", () => {
  it("loads verge state on open and toggles delay controls", async () => {
    vergeState.verge = {
      enable_auto_light_weight_mode: true,
      auto_light_weight_minutes: 15,
    };

    await renderViewer();

    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
    expect(
      screen.getByText(
        "When closing the window, LightWeight Mode will be automatically activated after _n minutes:15",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch"));
    expect(screen.queryByDisplayValue("15")).not.toBeInTheDocument();
  });

  it("saves configuration changes and closes dialog", async () => {
    await renderViewer();

    await userEvent.click(screen.getByRole("switch"));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "8" } });

    await userEvent.click(screen.getByText("Save"));

    expect(vergeState.patchVerge).toHaveBeenCalledWith({
      enable_auto_light_weight_mode: true,
      auto_light_weight_minutes: 8,
    });
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("shows notice when save fails and keeps dialog open", async () => {
    vergeState.patchVerge.mockRejectedValueOnce(new Error("patch failed"));

    await renderViewer();
    await userEvent.click(screen.getByText("Save"));

    expect(showNoticeMock).toHaveBeenCalledWith("error", "patch failed");
    expect(screen.getByTestId("dialog")).toBeInTheDocument();
  });

  it("invokes entry lightweight mode action", async () => {
    await renderViewer();
    await userEvent.click(screen.getByText("Enable"));

    expect(entryLiteModeMock).toHaveBeenCalled();
  });
});
