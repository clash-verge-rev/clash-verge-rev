import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BaseFieldset } from "@/components/base/base-fieldset";

describe("BaseFieldset", () => {
  const renderWithTheme = (ui: React.ReactElement) => {
    const theme = createTheme({ palette: { mode: "light" } });
    return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
  };

  it("renders label legend and children", () => {
    const { container } = renderWithTheme(
      <BaseFieldset
        label="Settings"
        width="200px"
        padding="20px"
        fontSize="14px"
      >
        <span>Content</span>
      </BaseFieldset>,
    );

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();

    const fieldset = container.querySelector("fieldset");
    expect(fieldset).toHaveStyle({ width: "200px", padding: "20px" });
  });
});
