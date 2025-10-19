import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { TestBox } from "@/components/test/test-box";

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe("TestBox", () => {
  it("renders non-selected state with default styles", () => {
    const { container } = renderWithTheme(
      <TestBox aria-selected={false}>
        <h2>Test Item</h2>
      </TestBox>,
    );

    const element = container.firstChild as HTMLElement;
    expect(element).toHaveStyle("width: 100%");
    expect(element.getAttribute("aria-selected")).toBe("false");
    expect(element).not.toHaveStyle("box-shadow: none");

    const heading = screen.getByRole("heading", { name: "Test Item" });
    expect(heading).not.toHaveStyle("color: rgb(25, 118, 210)");
  });

  it("applies selected styling when aria-selected is true", () => {
    const { container } = renderWithTheme(
      <TestBox aria-selected>
        <h2>Active Test</h2>
      </TestBox>,
    );

    const element = container.firstChild as HTMLElement;
    expect(element.getAttribute("aria-selected")).toBe("true");
    expect(element).toHaveStyle("cursor: pointer");

    const heading = screen.getByRole("heading", { name: "Active Test" });
    expect(heading).toHaveStyle("color: rgb(25, 118, 210)");
  });
});
