import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BaseStyledTextField } from "@/components/base/base-styled-text-field";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `i18n:${key}`,
  }),
}));

const renderWithTheme = (ui: React.ReactElement) => {
  const theme = createTheme({ palette: { mode: "light" } });
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

describe("BaseStyledTextField", () => {
  it("renders with translated placeholder and accepts input", async () => {
    const user = userEvent.setup();
    renderWithTheme(<BaseStyledTextField />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "i18n:Filter conditions");

    await user.type(input, "hello");
    expect(input).toHaveValue("hello");
  });
});
