import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Center } from "@/components/layout/Center";

describe("Center", () => {
  it("renders children content within the centered container", () => {
    render(
      <Center data-testid="center">
        <span>Nested content</span>
      </Center>,
    );

    expect(screen.getByTestId("center")).toHaveTextContent("Nested content");
  });

  it("forwards miscellaneous props to the underlying Box element", () => {
    const handleClick = vi.fn();

    render(
      <Center
        component="section"
        data-testid="center"
        aria-label="centered-block"
        onClick={handleClick}
      >
        click me
      </Center>,
    );

    const node = screen.getByTestId("center");

    expect(node.tagName).toBe("SECTION");
    expect(node).toHaveAttribute("aria-label", "centered-block");

    fireEvent.click(node);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies flex centering styles by default", () => {
    render(
      <Center data-testid="center">
        <span />
      </Center>,
    );

    const styles = getComputedStyle(screen.getByTestId("center"));
    expect(styles.display).toBe("flex");
    expect(styles.justifyContent).toBe("center");
    expect(styles.alignItems).toBe("center");
    expect(styles.width).toBe("100%");
    expect(styles.height).toBe("100%");
  });
});
