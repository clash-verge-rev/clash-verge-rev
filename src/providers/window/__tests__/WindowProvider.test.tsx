import { getCurrentWindow } from "@tauri-apps/api/window";
import { act, renderHook, waitFor } from "@testing-library/react";
import { PropsWithChildren, use, type ReactElement } from "react";
import {
  describe,
  it,
  beforeEach,
  afterEach,
  expect,
  vi,
  type MockInstance,
} from "vitest";

import {
  WindowContext,
  type WindowContextType,
} from "@/providers/window/WindowContext";
import { WindowProvider } from "@/providers/window/WindowProvider";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("@/utils/debounce", () => ({
  default: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

const mockedGetCurrentWindow = vi.mocked(getCurrentWindow);

type MockFn<T extends (...args: any[]) => any> = MockInstance<T>;

type MockWindow = {
  close: MockFn<() => Promise<void>>;
  minimize: MockFn<() => Promise<void>>;
  onResized: MockFn<
    (callback: (...args: unknown[]) => void) => Promise<() => void>
  >;
  isMaximized: MockFn<() => Promise<boolean>>;
  unmaximize: MockFn<() => Promise<void>>;
  maximize: MockFn<() => Promise<void>>;
  isFullscreen: MockFn<() => Promise<boolean>>;
  setFullscreen: MockFn<(value: boolean) => Promise<void>>;
  isDecorated: MockFn<() => Promise<boolean>>;
  setDecorations: MockFn<(value: boolean) => Promise<void>>;
  setMinimizable: MockFn<(value: boolean) => void>;
  listeners: Record<string, (...args: unknown[]) => void>;
  unlisten: MockFn<() => void>;
};

const createMockWindow = (): MockWindow => {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const unlisten = vi.fn<() => void>();

  return {
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    minimize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onResized: vi
      .fn<(callback: (...args: unknown[]) => void) => Promise<() => void>>()
      .mockImplementation((callback) => {
        listeners.resized = callback;
        return Promise.resolve(unlisten);
      }),
    isMaximized: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    unmaximize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    maximize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isFullscreen: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    setFullscreen: vi
      .fn<(value: boolean) => Promise<void>>()
      .mockResolvedValue(undefined),
    isDecorated: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    setDecorations: vi
      .fn<(value: boolean) => Promise<void>>()
      .mockResolvedValue(undefined),
    setMinimizable: vi.fn<(value: boolean) => void>(),
    listeners,
    unlisten,
  };
};

const useWindowContext = (): WindowContextType => {
  const context = use(WindowContext);
  if (!context) {
    throw new Error("WindowContext is not available");
  }

  return context;
};

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <WindowProvider>{children}</WindowProvider>
);

describe("WindowProvider", () => {
  beforeEach(() => {
    mockedGetCurrentWindow.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes decorated status on mount and cleans up the resize listener", async () => {
    const mockWindow = createMockWindow();
    mockWindow.isDecorated.mockResolvedValueOnce(true);
    mockedGetCurrentWindow.mockReturnValue(
      mockWindow as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const { result, unmount } = renderHook(useWindowContext, { wrapper });

    await waitFor(() => expect(result.current.decorated).toBe(true));
    expect(mockWindow.setMinimizable).toHaveBeenCalledWith(true);
    expect(mockWindow.onResized).toHaveBeenCalledTimes(1);

    unmount();
    await waitFor(() => expect(mockWindow.unlisten).toHaveBeenCalledTimes(1));
  });

  it("toggles window decorations and updates the decorated state", async () => {
    const mockWindow = createMockWindow();
    mockWindow.isDecorated.mockResolvedValueOnce(false);
    mockedGetCurrentWindow.mockReturnValue(
      mockWindow as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const { result } = renderHook(useWindowContext, { wrapper });

    await waitFor(() => expect(result.current.decorated).toBe(false));

    await act(async () => {
      await result.current.toggleDecorations();
    });

    expect(mockWindow.setDecorations).toHaveBeenCalledWith(true);
    await waitFor(() => expect(result.current.decorated).toBe(true));
  });

  it("toggles the maximized state in both directions", async () => {
    const mockWindow = createMockWindow();
    mockWindow.isDecorated.mockResolvedValueOnce(false);
    mockedGetCurrentWindow.mockReturnValue(
      mockWindow as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const { result } = renderHook(useWindowContext, { wrapper });

    await waitFor(() => expect(result.current.decorated).toBe(false));

    mockWindow.isMaximized.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.toggleMaximize();
    });

    expect(mockWindow.maximize).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.maximized).toBe(true));

    mockWindow.isMaximized.mockResolvedValueOnce(true);
    await act(async () => {
      await result.current.toggleMaximize();
    });

    expect(mockWindow.unmaximize).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.maximized).toBe(false));
  });

  it("controls fullscreen, minimize, and close actions", async () => {
    const mockWindow = createMockWindow();
    mockWindow.isDecorated.mockResolvedValueOnce(true);
    mockedGetCurrentWindow.mockReturnValue(
      mockWindow as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const { result } = renderHook(useWindowContext, { wrapper });

    await waitFor(() => expect(result.current.decorated).toBe(true));

    mockWindow.isFullscreen.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.toggleFullscreen();
    });
    expect(mockWindow.setFullscreen).toHaveBeenCalledWith(true);

    await act(async () => {
      await result.current.minimize();
    });
    expect(mockWindow.minimize).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.close();
    });
    expect(mockWindow.close).toHaveBeenCalledTimes(1);
  });

  it("updates maximized state when the debounced resize handler fires", async () => {
    const mockWindow = createMockWindow();
    mockedGetCurrentWindow.mockReturnValue(
      mockWindow as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const { result } = renderHook(useWindowContext, { wrapper });

    await waitFor(() => expect(mockWindow.onResized).toHaveBeenCalledTimes(1));

    mockWindow.isMaximized.mockResolvedValueOnce(true);

    await act(async () => {
      mockWindow.listeners.resized?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.maximized).toBe(true));
  });
});
