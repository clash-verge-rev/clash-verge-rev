import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BasePage } from "@/components/base/base-page";

const renderWithTheme = (
  ui: React.ReactNode,
  paletteMode: "light" | "dark" = "light",
) => {
  const theme = createTheme({ palette: { mode: paletteMode } });
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

describe("BasePage", () => {
  it("renders title, header, and children content", () => {
    const { container, getByText } = renderWithTheme(
      <BasePage
        title="Dashboard"
        header={<button type="button">Action</button>}
        contentStyle={{ padding: 8 }}
      >
        <span>Body content</span>
      </BasePage>,
    );

    expect(getByText("Dashboard")).toBeInTheDocument();
    expect(getByText("Action")).toBeInTheDocument();
    expect(getByText("Body content")).toBeInTheDocument();

    const header = container.querySelector("header");
    expect(header).toHaveAttribute("data-tauri-drag-region", "true");

    const baseContent = container.querySelector(".base-content");
    expect(baseContent).toHaveStyle({ padding: "8px" });
  });

  it("applies full layout and dark theme background styles", () => {
    const { container } = renderWithTheme(
      <BasePage full title="Full Layout">
        content
      </BasePage>,
      "dark",
    );

    const containerDiv = container.querySelector(".base-container");
    expect(containerDiv).toHaveClass("no-padding");
    expect(containerDiv).toHaveStyle({ backgroundColor: "#1e1f27" });
  });
});
