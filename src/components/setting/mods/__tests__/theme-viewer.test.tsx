let imperativeHandle: { open: () => void; close: () => void } | undefined;

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useImperativeHandle: (
      ref: any,
      create: () => { open: () => void; close: () => void },
      deps?: any,
    ) => {
      const value = create();
      imperativeHandle = value;
      return actual.useImperativeHandle(ref, () => value, deps);
    },
  };
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useVergeMock = vi.fn();
const patchVergeMock = vi.fn();
const editorInstances: Array<Record<string, any>> = [];
let paletteMode: "light" | "dark" = "light";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: vi.fn(),
}));

vi.mock("@/components/base", async () => {
  await import("react");
  return {
    BaseDialog: ({
      open,
      title,
      children,
      okBtn,
      cancelBtn,
      onOk,
      onCancel,
      onClose,
    }: {
      open: boolean;
      title: string;
      children: ReactModule.ReactNode;
      okBtn?: ReactModule.ReactNode;
      cancelBtn?: ReactModule.ReactNode;
      onOk?: () => void;
      onCancel?: () => void;
      onClose?: () => void;
    }) => {
      if (!open) return null;
      return (
        <div data-testid="theme-dialog">
          <div data-testid="theme-dialog-title">{title}</div>
          <div data-testid="theme-dialog-content">{children}</div>
          <button type="button" onClick={onCancel}>
            {cancelBtn}
          </button>
          <button type="button" onClick={onOk}>
            {okBtn}
          </button>
          <button
            type="button"
            data-testid="theme-dialog-close"
            onClick={onClose}
          >
            close
          </button>
        </div>
      );
    },
  };
});

vi.mock("@/components/profile/editor-viewer", () => ({
  EditorViewer: (props: Record<string, any>) => {
    editorInstances.push(props);
    return <div data-testid="editor-viewer" />;
  },
}));

vi.mock("@/pages/_theme", () => ({
  defaultTheme: {
    primary_color: "#111111",
    secondary_color: "#222222",
    primary_text: "#333333",
    secondary_text: "#444444",
    info_color: "#555555",
    warning_color: "#666666",
    error_color: "#777777",
    success_color: "#888888",
    font_family: "Default Font",
  },
  defaultDarkTheme: {
    primary_color: "#aaaaaa",
    secondary_color: "#bbbbbb",
    primary_text: "#cccccc",
    secondary_text: "#dddddd",
    info_color: "#eeeeee",
    warning_color: "#ffffff",
    error_color: "#000000",
    success_color: "#123123",
    font_family: "Dark Font",
  },
}));

vi.mock("@mui/material", async () => {
  const actual =
    await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    useTheme: () => ({
      palette: {
        mode: paletteMode,
      },
    }),
  };
});

import { defaultDarkTheme } from "@/pages/_theme";
import { showNotice } from "@/services/noticeService";

import { ThemeViewer } from "../theme-viewer";

const showNoticeMock = vi.mocked(showNotice);

const createThemeSetting = () => ({
  primary_color: "#123456",
  secondary_color: "#abcdef",
  primary_text: "#010101",
  secondary_text: "#020202",
  info_color: "#030303",
  warning_color: "#040404",
  error_color: "#050505",
  success_color: "#060606",
  font_family: "Custom Font",
  css_injection: "body { color: red; }",
});

const renderAndOpen = async () => {
  render(<ThemeViewer />);
  expect(imperativeHandle).toBeDefined();
  await act(async () => {
    imperativeHandle?.open();
  });
  await screen.findByTestId("theme-dialog");
};

beforeEach(() => {
  paletteMode = "light";
  editorInstances.length = 0;
  imperativeHandle = undefined;
  patchVergeMock.mockReset();
  patchVergeMock.mockResolvedValue(undefined);
  showNoticeMock.mockReset();
  useVergeMock.mockReset();
  useVergeMock.mockReturnValue({
    verge: { theme_setting: createThemeSetting() },
    patchVerge: patchVergeMock,
  });
});

describe("ThemeViewer", () => {
  it("opens through the imperative handle and saves modified values", async () => {
    await renderAndOpen();

    const user = userEvent.setup();
    const secondaryInput = screen.getByDisplayValue(
      "#abcdef",
    ) as HTMLInputElement;
    await user.clear(secondaryInput);
    await user.type(secondaryInput, "#fedcba");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({
        theme_setting: expect.objectContaining({
          primary_color: "#123456",
          secondary_color: "#fedcba",
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("theme-dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps the dialog open and reports an error when saving fails", async () => {
    patchVergeMock.mockRejectedValueOnce(new Error("save-failed"));

    await renderAndOpen();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith(
        "error",
        "Error: save-failed",
      ),
    );
    expect(screen.getByTestId("theme-dialog")).toBeInTheDocument();
  });

  it("opens the CSS editor and persists css_injection changes before saving", async () => {
    await renderAndOpen();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit CSS" }));

    await waitFor(() => expect(editorInstances.length).toBeGreaterThan(0));
    await expect(editorInstances.at(-1)?.initialData).resolves.toBe(
      "body { color: red; }",
    );

    act(() => {
      editorInstances.at(-1)?.onSave?.("", "body { color: blue; }");
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({
        theme_setting: expect.objectContaining({
          css_injection: "body { color: blue; }",
        }),
      }),
    );
  });

  it("uses dark theme defaults for placeholders when palette mode is dark", async () => {
    paletteMode = "dark";
    useVergeMock.mockReturnValueOnce({
      verge: { theme_setting: {} },
      patchVerge: patchVergeMock,
    });

    await renderAndOpen();

    const primaryInput = screen.getByPlaceholderText(
      defaultDarkTheme.primary_color,
    ) as HTMLInputElement;
    expect(primaryInput.value).toBe("");
    expect(
      screen.getByPlaceholderText(defaultDarkTheme.secondary_color),
    ).toBeInTheDocument();
  });

  it("triggers save when pressing Enter on a text field", async () => {
    await renderAndOpen();

    const primaryInput = screen.getByDisplayValue(
      createThemeSetting().primary_color,
    ) as HTMLInputElement;

    fireEvent.keyDown(primaryInput, { key: "Enter" });

    await waitFor(() => expect(patchVergeMock).toHaveBeenCalledTimes(1));
  });
});
