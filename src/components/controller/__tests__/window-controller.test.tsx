import type { Window } from "@tauri-apps/api/window";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  WindowControls,
  type WindowControlsHandle,
} from "@/components/controller/window-controller";
import { useWindowControls } from "@/hooks/use-window";
import getSystem from "@/utils/get-system";

vi.mock("@/hooks/use-window", () => ({
  useWindowControls: vi.fn(),
}));

vi.mock("@/utils/get-system", () => ({
  default: vi.fn(),
}));

const mockUseWindowControls = vi.mocked(useWindowControls);
const mockGetSystem = vi.mocked(getSystem);

type ControlAction = "close" | "minimize" | "toggleMaximize";

const mockCurrentWindow = {
  label: "main-window",
} as unknown as Window;

const createControlsMock = (
  overrides?: Partial<WindowControlsHandle>,
): WindowControlsHandle =>
  ({
    currentWindow: mockCurrentWindow,
    maximized: false,
    minimize: vi.fn() as WindowControlsHandle["minimize"],
    close: vi.fn() as WindowControlsHandle["close"],
    toggleFullscreen: vi.fn(
      async () => {},
    ) as WindowControlsHandle["toggleFullscreen"],
    toggleMaximize: vi.fn(
      async () => {},
    ) as WindowControlsHandle["toggleMaximize"],
    ...overrides,
  }) as WindowControlsHandle;

describe("WindowControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["macos", ["close", "minimize", "toggleMaximize"]],
    ["windows", ["minimize", "toggleMaximize", "close"]],
    ["linux", ["minimize", "toggleMaximize", "close"]],
  ] as const)(
    "renders %s layout and wires button clicks",
    async (os, expectedOrder) => {
      const user = userEvent.setup();
      const controls = createControlsMock();

      mockGetSystem.mockReturnValue(os);
      mockUseWindowControls.mockReturnValue(controls);

      render(<WindowControls />);

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(3);

      const actionMap: Record<ControlAction, () => unknown> = {
        close: controls.close,
        minimize: controls.minimize,
        toggleMaximize: controls.toggleMaximize,
      };

      for (const [index, actionKey] of expectedOrder.entries()) {
        await user.click(buttons[index]);
        expect(actionMap[actionKey]).toHaveBeenCalledTimes(1);
      }

      const untouchedActions = (
        Object.keys(actionMap) as ControlAction[]
      ).filter((key) => !expectedOrder.includes(key));

      for (const action of untouchedActions) {
        expect(actionMap[action]).not.toHaveBeenCalled();
      }
    },
  );

  it("exposes imperative handlers from useWindowControls through refs", () => {
    const controls = createControlsMock({ maximized: true });

    mockGetSystem.mockReturnValue("windows");
    mockUseWindowControls.mockReturnValue(controls);

    let refValue!: WindowControlsHandle;

    render(
      <WindowControls
        ref={(value) => {
          if (!value) {
            throw new Error("Expected refValue to be assigned");
          }
          refValue = value;
        }}
      />,
    );

    expect(refValue.maximized).toBe(true);
    expect(refValue.currentWindow).toBe(controls.currentWindow);
    expect(refValue.minimize).toBe(controls.minimize);
    expect(refValue.close).toBe(controls.close);
    expect(refValue.toggleMaximize).toBe(controls.toggleMaximize);
    expect(refValue.toggleFullscreen).toBe(controls.toggleFullscreen);
  });
});
