import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseErrorBoundary } from "@/components/base/base-error-boundary";

const ProblemChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error("Kaboom");
  }

  return <div>safe content</div>;
};

describe("BaseErrorBoundary", () => {
  it("renders fallback UI when a descendant throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(
        <BaseErrorBoundary>
          <ProblemChild shouldThrow />
        </BaseErrorBoundary>,
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Something went wrong:(")).toBeInTheDocument();
      expect(screen.getByText("Kaboom")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("renders children when no error is thrown", () => {
    const { getByText } = render(
      <BaseErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </BaseErrorBoundary>,
    );

    expect(getByText("safe content")).toBeInTheDocument();
  });
});
