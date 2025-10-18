import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Switch as BaseSwitch } from "@/components/base/base-switch";

const ControlledSwitch = () => {
  const [checked, setChecked] = useState(false);

  return (
    <>
      <span data-testid="status">{checked ? "on" : "off"}</span>
      <BaseSwitch
        checked={checked}
        onChange={(_, nextChecked) => setChecked(nextChecked)}
      />
    </>
  );
};

describe("BaseSwitch", () => {
  it("toggles in a controlled scenario", async () => {
    const user = userEvent.setup();
    render(<ControlledSwitch />);

    const control = screen.getByRole("switch");
    const status = screen.getByTestId("status");

    expect(status).toHaveTextContent("off");
    await user.click(control);
    expect(status).toHaveTextContent("on");
    await user.click(control);
    expect(status).toHaveTextContent("off");
  });

  it("does not trigger change when disabled", () => {
    const onChange = vi.fn();
    render(<BaseSwitch disabled onChange={onChange} />);

    const control = screen.getByRole("switch") as HTMLInputElement;
    expect(control).toBeDisabled();

    control.click();

    expect(onChange).not.toHaveBeenCalled();
    expect(control.checked).toBe(false);
  });
});
