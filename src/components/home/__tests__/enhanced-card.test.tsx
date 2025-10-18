import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

expect.extend(matchers);

import { EnhancedCard } from "@/components/home/enhanced-card";

describe("EnhancedCard", () => {
  it("renders string titles, icons, actions, and children", () => {
    render(
      <EnhancedCard
        title="Sample Title"
        icon={<span data-testid="card-icon">*</span>}
        action={
          <button type="button" aria-label="Card Action">
            action
          </button>
        }
      >
        <div>Card body content</div>
      </EnhancedCard>,
    );

    expect(screen.getByText("Sample Title")).toBeInTheDocument();
    expect(screen.getByTestId("card-icon")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Card Action" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Card body content")).toBeInTheDocument();
  });

  it("supports custom title nodes and respects layout props", () => {
    render(
      <EnhancedCard
        title={<span data-testid="custom-title">Custom Title</span>}
        icon={<span />}
        minHeight={200}
        noContentPadding
      >
        <p>Body Text</p>
      </EnhancedCard>,
    );

    expect(screen.getByTestId("custom-title")).toBeInTheDocument();

    const contentContainer = screen.getByText("Body Text").parentElement;
    expect(contentContainer).toHaveStyle({ padding: "0px" });
    expect(contentContainer).toHaveStyle({ minHeight: "200px" });
  });
});
