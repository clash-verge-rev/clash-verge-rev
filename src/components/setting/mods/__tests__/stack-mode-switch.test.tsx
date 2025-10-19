import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StackModeSwitch } from "../stack-mode-switch";

const expectVariant = (label: string, variant: "contained" | "outlined") => {
  const button = screen.getByRole("button", { name: label });
  expect(button.className).toMatch(
    variant === "contained" ? /MuiButton-contained/ : /MuiButton-outlined/,
  );
};

describe("StackModeSwitch", () => {
  it("highlights the current value regardless of case", () => {
    const { rerender } = render(
      <StackModeSwitch value="system" onChange={vi.fn()} />,
    );

    expectVariant("System", "contained");
    expectVariant("gVisor", "outlined");
    expectVariant("Mixed", "outlined");

    rerender(<StackModeSwitch value="GVisor" onChange={vi.fn()} />);

    expectVariant("System", "outlined");
    expectVariant("gVisor", "contained");
  });

  it("emits the selected value when a button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<StackModeSwitch value="system" onChange={onChange} />);

    const mixedButton = screen.getByRole("button", { name: "Mixed" });
    await user.click(mixedButton);

    expect(onChange).toHaveBeenCalledWith("mixed");
  });
});
