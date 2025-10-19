import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ProfileBox } from "@/components/profile/profile-box";

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe("ProfileBox", () => {
  it("renders non-selected layout without modifiers", () => {
    const { container } = renderWithTheme(
      <ProfileBox aria-selected={false}>
        <h2>Profile</h2>
      </ProfileBox>,
    );

    const element = container.firstChild as HTMLElement;
    expect(element.getAttribute("aria-selected")).toBe("false");
    // width is left untouched when not selected
    expect(element).toHaveStyle("width: 100%");
    expect(element).not.toHaveStyle("border-left: 3px solid rgb(25, 118, 210)");

    const heading = screen.getByRole("heading", { name: "Profile" });
    expect(heading).not.toHaveStyle("color: rgb(25, 118, 210)");
  });

  it("applies selection styles when aria-selected is true", () => {
    const { container } = renderWithTheme(
      <ProfileBox aria-selected={true}>
        <h2>Active Profile</h2>
      </ProfileBox>,
    );

    const element = container.firstChild as HTMLElement;
    expect(element.getAttribute("aria-selected")).toBe("true");
    expect(element).toHaveStyle("width: calc(100% + 3px)");
    expect(element).toHaveStyle("margin-left: -3px");
    expect(element).toHaveStyle("border-left: 3px solid #1976d2");

    const heading = screen.getByRole("heading", { name: "Active Profile" });
    expect(heading).toHaveStyle("color: rgb(25, 118, 210)");
  });
});
