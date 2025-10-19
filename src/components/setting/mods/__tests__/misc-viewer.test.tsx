import "@testing-library/jest-dom/vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const patchVergeMock = vi.fn();
const showNoticeMock = vi.fn();

type VergeConfig = Partial<IVergeConfig> & {
  app_log_level: string;
  app_log_max_size: number;
  app_log_max_count: number;
  auto_close_connection: boolean;
  auto_check_update: boolean;
  enable_builtin_enhanced: boolean;
  proxy_layout_column: number;
  enable_auto_delay_detection: boolean;
  default_latency_test: string;
  auto_log_clean: number;
  default_latency_timeout: number;
};

let vergeConfig: VergeConfig;

vi.mock("ahooks", () => ({
  useLockFn:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.n !== undefined) {
        return key.replace("_n", String(options.n));
      }
      return key;
    },
  }),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({
    verge: vergeConfig,
    patchVerge: patchVergeMock,
  }),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/components/base", () => ({
  BaseDialog: ({
    open,
    title,
    children,
    okBtn,
    cancelBtn,
    onOk,
    onCancel,
  }: {
    open: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    okBtn?: React.ReactNode;
    cancelBtn?: React.ReactNode;
    onOk?: () => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="misc-dialog">
        <div data-testid="misc-dialog-title">{title}</div>
        <div>{children}</div>
        <div>
          {cancelBtn && (
            <button type="button" onClick={onCancel}>
              {cancelBtn}
            </button>
          )}
          {okBtn && (
            <button type="button" onClick={onOk}>
              {okBtn}
            </button>
          )}
        </div>
      </div>
    );
  },
  Switch: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange?: (
      event: React.ChangeEvent<HTMLInputElement>,
      checked: boolean,
    ) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onChange?.(event, event.target.checked)}
    />
  ),
  DialogRef: {} as any,
}));

vi.mock("@/components/base/base-tooltip-icon", () => ({
  TooltipIcon: ({ title }: { title: React.ReactNode }) => (
    <span data-testid={`tooltip-${String(title)}`} />
  ),
}));

let MiscViewer: (typeof import("../misc-viewer"))["MiscViewer"];

beforeAll(async () => {
  ({ MiscViewer } = await import("../misc-viewer"));
});

type DialogHandle = { open: () => void; close: () => void };

const Host = ({ onReady }: { onReady: (handle: DialogHandle) => void }) => {
  const ref = useRef<DialogHandle | null>(null);

  useEffect(() => {
    if (ref.current) {
      onReady(ref.current);
    }
  }, [onReady]);

  return <MiscViewer ref={ref} />;
};

const openMiscViewer = async () => {
  let handle: DialogHandle | null = null;
  render(<Host onReady={(next) => (handle = next)} />);
  await waitFor(() => expect(handle).not.toBeNull());
  await act(async () => {
    handle?.open();
  });
  await waitFor(() => expect(screen.getByTestId("misc-dialog")).toBeVisible());
};

beforeEach(() => {
  vi.clearAllMocks();
  patchVergeMock.mockResolvedValue(undefined);
  vergeConfig = {
    app_log_level: "info",
    app_log_max_size: 256,
    app_log_max_count: 16,
    auto_close_connection: false,
    auto_check_update: true,
    enable_builtin_enhanced: true,
    proxy_layout_column: 6,
    enable_auto_delay_detection: true,
    default_latency_test: "https://latency.example/test",
    auto_log_clean: 2,
    default_latency_timeout: 1500,
  };
});

describe("MiscViewer", () => {
  it("opens via ref, hydrates values, and clamps numeric inputs", async () => {
    await openMiscViewer();

    expect(screen.getByTestId("misc-dialog-title")).toHaveTextContent(
      "Miscellaneous",
    );

    const initialLogLevelSelect = within(
      screen.getByText("App Log Level").closest("li") as HTMLElement,
    ).getByRole("combobox");
    expect(initialLogLevelSelect).toHaveTextContent("Info");
    expect(screen.getByDisplayValue("256")).toBeInTheDocument();
    expect(screen.getByDisplayValue("16")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://latency.example/test"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("1500")).toBeInTheDocument();

    const autoCloseItem = screen
      .getByText("Auto Close Connections")
      .closest("li");
    expect(
      within(autoCloseItem as HTMLElement).getByRole("switch"),
    ).not.toBeChecked();

    const autoDelayItem = screen
      .getByText("Auto Delay Detection")
      .closest("li");
    expect(
      within(autoDelayItem as HTMLElement).getByRole("switch"),
    ).toBeChecked();

    const maxSizeInput = within(
      screen.getByText("App Log Max Size").closest("li") as HTMLElement,
    ).getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(maxSizeInput, { target: { value: "0" } });
    await waitFor(() => expect(maxSizeInput.value).toBe("128"));

    const maxCountInput = within(
      screen.getByText("App Log Max Count").closest("li") as HTMLElement,
    ).getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(maxCountInput, { target: { value: "0" } });
    await waitFor(() => expect(maxCountInput.value).toBe("1"));
  });

  it("updates values and saves changes through patchVerge", async () => {
    await openMiscViewer();
    const user = userEvent.setup();

    const logLevelSelect = within(
      screen.getByText("App Log Level").closest("li") as HTMLElement,
    ).getByRole("combobox");
    await user.click(logLevelSelect);
    await user.click(await screen.findByRole("option", { name: "Error" }));

    const autoCloseSwitch = within(
      screen.getByText("Auto Close Connections").closest("li") as HTMLElement,
    ).getByRole("switch");
    await user.click(autoCloseSwitch);

    const autoCheckSwitch = within(
      screen.getByText("Auto Check Update").closest("li") as HTMLElement,
    ).getByRole("switch");
    await user.click(autoCheckSwitch);

    const builtinSwitch = within(
      screen.getByText("Enable Builtin Enhanced").closest("li") as HTMLElement,
    ).getByRole("switch");
    await user.click(builtinSwitch);

    const proxyLayoutSelect = within(
      screen.getByText("Proxy Layout Columns").closest("li") as HTMLElement,
    ).getByRole("combobox");
    await user.click(proxyLayoutSelect);
    await user.click(await screen.findByRole("option", { name: "4" }));

    const autoLogCleanSelect = within(
      screen.getByText("Auto Log Clean").closest("li") as HTMLElement,
    ).getByRole("combobox");
    await user.click(autoLogCleanSelect);
    await user.click(
      await screen.findByRole("option", { name: "Retain 30 Days" }),
    );

    const autoDelaySwitch = within(
      screen.getByText("Auto Delay Detection").closest("li") as HTMLElement,
    ).getByRole("switch");
    await user.click(autoDelaySwitch);

    const latencyTestInput = within(
      screen.getByText("Default Latency Test").closest("li") as HTMLElement,
    ).getByRole("textbox") as HTMLInputElement;
    await user.clear(latencyTestInput);
    await user.type(latencyTestInput, "https://foo.dev/ping");

    const latencyTimeoutInput = within(
      screen.getByText("Default Latency Timeout").closest("li") as HTMLElement,
    ).getByRole("spinbutton") as HTMLInputElement;
    await user.clear(latencyTimeoutInput);
    await user.type(latencyTimeoutInput, "2000");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({
        app_log_level: "error",
        auto_close_connection: true,
        auto_check_update: false,
        enable_builtin_enhanced: false,
        proxy_layout_column: 4,
        enable_auto_delay_detection: false,
        default_latency_test: "https://foo.dev/ping",
        default_latency_timeout: 2000,
        auto_log_clean: 3,
      }),
    );
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it("notifies on save failure and keeps dialog open", async () => {
    const error = new Error("failure");
    patchVergeMock.mockRejectedValueOnce(error);
    await openMiscViewer();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith("error", "Error: failure"),
    );
    expect(screen.getByTestId("misc-dialog")).toBeInTheDocument();
  });
});
