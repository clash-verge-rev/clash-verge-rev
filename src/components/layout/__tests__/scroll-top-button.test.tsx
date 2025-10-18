import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScrollTopButton } from "@/components/layout/scroll-top-button";

describe("ScrollTopButton", () => {
  it("renders with visibility hidden when show is false", () => {
    const handleClick = vi.fn();

    render(<ScrollTopButton show={false} onClick={handleClick} />);

    const button = screen.getByRole("button", { hidden: true });
    expect(button).toHaveStyle({ visibility: "hidden" });
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies custom styles and becomes visible when show is true", () => {
    const handleClick = vi.fn();

    render(
      <ScrollTopButton
        show
        onClick={handleClick}
        sx={{ bottom: "10px", right: "12px" }}
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveStyle({ visibility: "visible" });
    expect(button).toHaveStyle({ bottom: "10px", right: "12px" });

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
