import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuardState } from "@/components/setting/mods/guard-state";

const Harness = ({
  initial = false,
  waitTime = 0,
  onGuard = vi.fn(),
  onCatch = vi.fn(),
}: {
  initial?: boolean;
  waitTime?: number;
  onGuard?: ReturnType<typeof vi.fn>;
  onCatch?: ReturnType<typeof vi.fn>;
}) => {
  const Wrapper = () => {
    const [value, setValue] = React.useState(initial);
    return (
      <GuardState
        value={value}
        valueProps="checked"
        waitTime={waitTime}
        onFormat={(event: React.ChangeEvent<HTMLInputElement>) =>
          event.target.checked
        }
        onChange={setValue}
        onGuard={async (next, prev) => onGuard(next, prev)}
        onCatch={onCatch}
      >
        <input type="checkbox" role="switch" />
      </GuardState>
    );
  };

  return {
    onGuard,
    onCatch,
    render: () => render(<Wrapper />),
  };
};

describe("GuardState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes guard with the new and old values", async () => {
    const onGuard = vi.fn().mockResolvedValue(undefined);
    const { render: renderHarness } = Harness({ onGuard });

    renderHarness();

    const user = userEvent.setup();
    const checkbox = screen.getByRole("switch");
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
    expect(onGuard).toHaveBeenCalledWith(true, false);
  });

  it("reverts to previous state and calls onCatch when guard rejects", async () => {
    const error = new Error("failure");
    const onCatch = vi.fn();
    const onGuard = vi.fn().mockRejectedValue(error);
    const { render: renderHarness } = Harness({ onGuard, onCatch });

    renderHarness();

    const user = userEvent.setup();
    const checkbox = screen.getByRole("switch");

    await user.click(checkbox);

    await waitFor(() => expect(onGuard).toHaveBeenCalledWith(true, false));
    await waitFor(() => expect(onCatch).toHaveBeenCalledWith(error));
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("debounces guard invocation when waitTime is provided", async () => {
    const onGuard = vi.fn().mockResolvedValue(undefined);
    const { render: renderHarness } = Harness({ waitTime: 20, onGuard });

    renderHarness();
    const checkbox = screen.getByRole("switch");

    fireEvent.click(checkbox); // true
    fireEvent.click(checkbox); // false

    expect(onGuard).not.toHaveBeenCalled();

    await waitFor(() => expect(onGuard).toHaveBeenCalledTimes(1), {
      timeout: 500,
    });
    expect(onGuard.mock.calls[0]).toEqual([false, false]);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });
});
