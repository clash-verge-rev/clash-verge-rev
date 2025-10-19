import { alpha, ThemeProvider, createTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { EnhancedCard } from "@/components/home/enhanced-card";

const renderWithTheme = (
  ui: ReactElement,
  themeOptions?: Parameters<typeof createTheme>[0],
) => {
  const theme = createTheme(themeOptions);
  const result = render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
  return { theme, ...result };
};

describe("EnhancedCard", () => {
  it("renders string title inside Typography with tooltip", () => {
    renderWithTheme(
      <EnhancedCard title="Status" icon={<span data-testid="icon" />}>
        <div>Body</div>
      </EnhancedCard>,
    );

    const heading = screen.getByRole("heading", { name: "Status" });
    expect(heading).toHaveAttribute("title", "Status");
  });

  it("renders node title without Typography wrapping", () => {
    renderWithTheme(
      <EnhancedCard
        title={<span data-testid="custom-title">Custom</span>}
        icon={<span data-testid="icon" />}
      >
        <div>Body</div>
      </EnhancedCard>,
    );

    expect(screen.queryByRole("heading", { name: "Custom" })).toBeNull();
    expect(screen.getByTestId("custom-title")).toBeInTheDocument();
  });

  it("applies icon color styles based on palette", () => {
    const { theme } = renderWithTheme(
      <EnhancedCard
        title="Status"
        icon={<span data-testid="icon-element" />}
        iconColor="success"
      >
        <div>Body</div>
      </EnhancedCard>,
    );

    const iconWrapper = screen.getByTestId("icon-element").parentElement;
    expect(iconWrapper).not.toBeNull();
    const expectedColor = alpha(theme.palette.success.main, 0.12);
    expect(iconWrapper).toHaveStyle({
      backgroundColor: expectedColor,
      color: theme.palette.success.main,
    });
  });

  it("sets no padding when noContentPadding is true", () => {
    renderWithTheme(
      <EnhancedCard title="Status" icon={<span />} noContentPadding>
        <div>Content</div>
      </EnhancedCard>,
    );

    const contentWrapper = screen.getByText("Content").parentElement;
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper).toHaveStyle({ padding: "0px" });
  });

  it("applies minHeight when provided", () => {
    renderWithTheme(
      <EnhancedCard title="Status" icon={<span />} minHeight={240}>
        <div>Content</div>
      </EnhancedCard>,
    );

    const contentWrapper = screen.getByText("Content").parentElement;
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper).toHaveStyle({ minHeight: "240px" });
  });

  it("uses dark background color in dark mode", () => {
    const { container } = renderWithTheme(
      <EnhancedCard title="Status" icon={<span />}>
        <div>Content</div>
      </EnhancedCard>,
      { palette: { mode: "dark" } },
    );

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root).toHaveStyle({ backgroundColor: "#282a36" });
  });
});
