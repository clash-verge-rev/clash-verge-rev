import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { ThemeModeSwitch } from "../theme-mode-switch";

const expectVariant = (label: string, variant: "contained" | "outlined") => {
  const button = screen.getByRole("button", { name: label });
  expect(button.className).toMatch(
    variant === "contained" ? /MuiButton-contained/ : /MuiButton-outlined/,
  );
};

describe("ThemeModeSwitch", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
  });

  it("renders all theme options with the active one highlighted", () => {
    const { rerender } = render(
      <ThemeModeSwitch value="dark" onChange={onChange} />,
    );

    expectVariant("theme.light", "outlined");
    expectVariant("theme.dark", "contained");
    expectVariant("theme.system", "outlined");

    rerender(<ThemeModeSwitch value="system" onChange={onChange} />);
    expectVariant("theme.system", "contained");
  });

  it("invokes onChange with the selected mode", async () => {
    const user = userEvent.setup();
    render(<ThemeModeSwitch value="light" onChange={onChange} />);

    const systemButton = screen.getByRole("button", { name: "theme.system" });
    await user.click(systemButton);

    expect(onChange).toHaveBeenCalledWith("system");
  });
});
