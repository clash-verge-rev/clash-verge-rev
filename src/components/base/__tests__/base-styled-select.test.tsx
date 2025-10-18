import { MenuItem, ThemeProvider, createTheme } from "@mui/material";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BaseStyledSelect } from "@/components/base/base-styled-select";

const renderWithTheme = (ui: React.ReactElement) => {
  const theme = createTheme({ palette: { mode: "light" } });
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

describe("BaseStyledSelect", () => {
  it("renders select with provided options and reacts to selection", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    renderWithTheme(
      <BaseStyledSelect
        value="one"
        onChange={handleChange}
        displayEmpty
        MenuProps={{ disablePortal: true }}
        inputProps={{ "aria-label": "base select" }}
      >
        <MenuItem value="one">One</MenuItem>
        <MenuItem value="two">Two</MenuItem>
      </BaseStyledSelect>,
    );

    const select = screen.getByRole("combobox", { name: "base select" });
    const root = select.parentElement as HTMLElement;
    expect(root).toHaveStyle({ width: "120px" });

    await user.click(select);
    const option = await screen.findByText("Two");
    await user.click(option);

    await waitFor(() => expect(handleChange).toHaveBeenCalled());
  });
});
