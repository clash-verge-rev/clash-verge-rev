import { renderHook } from "@testing-library/react";
import type { JSX, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useWindow,
  useWindowControls,
  useWindowDecorations,
} from "@/hooks/use-window";
import {
  WindowContext,
  type WindowContextType,
} from "@/providers/window/WindowContext";

const createContextValue = (): WindowContextType => ({
  decorated: true,
  maximized: false,
  toggleDecorations: vi.fn().mockResolvedValue(undefined),
  refreshDecorated: vi.fn().mockResolvedValue(true),
  minimize: vi.fn(),
  close: vi.fn(),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  toggleFullscreen: vi.fn().mockResolvedValue(undefined),
  currentWindow: {} as WindowContextType["currentWindow"],
});

const createWrapper =
  (value: WindowContextType) =>
  ({ children }: PropsWithChildren): JSX.Element => (
    <WindowContext value={value}>{children}</WindowContext>
  );

describe("useWindow hooks", () => {
  it("throws when used outside of WindowProvider", () => {
    expect(() => renderHook(() => useWindow())).toThrow(
      "useWindow must be used within WindowProvider",
    );
  });

  it("returns the full window context when within the provider", () => {
    const value = createContextValue();
    const wrapper = createWrapper(value);

    const { result } = renderHook(() => useWindow(), { wrapper });

    expect(result.current).toBe(value);
  });

  it("provides the control handle subset via useWindowControls", async () => {
    const value = createContextValue();
    const wrapper = createWrapper(value);

    const { result } = renderHook(() => useWindowControls(), { wrapper });

    expect(result.current).toEqual({
      maximized: value.maximized,
      minimize: value.minimize,
      toggleMaximize: value.toggleMaximize,
      close: value.close,
      toggleFullscreen: value.toggleFullscreen,
      currentWindow: value.currentWindow,
    });
  });

  it("provides decoration helpers via useWindowDecorations", () => {
    const value = createContextValue();
    const wrapper = createWrapper(value);

    const { result } = renderHook(() => useWindowDecorations(), { wrapper });

    expect(result.current).toEqual({
      decorated: value.decorated,
      toggleDecorations: value.toggleDecorations,
      refreshDecorated: value.refreshDecorated,
    });
  });
});
