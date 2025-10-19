import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ScrollTopButton } from "@/components/layout/scroll-top-button";

vi.mock("@mui/material", async () => {
  const actual =
    await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    Fade: ({ in: isIn, children }: { in: boolean; children: ReactNode }) =>
      isIn ? <>{children}</> : null,
  };
});

describe("ScrollTopButton", () => {
  it("renders hidden when show is false", () => {
    render(<ScrollTopButton show={false} onClick={vi.fn()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders button and triggers onClick when visible", () => {
    const handleClick = vi.fn();

    render(<ScrollTopButton show onClick={handleClick} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
