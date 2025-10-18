import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BaseLoadingOverlay } from "@/components/base/base-loading-overlay";

describe("BaseLoadingOverlay", () => {
  it("returns null when not loading", () => {
    const { container } = render(<BaseLoadingOverlay isLoading={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a circular progress when loading", () => {
    render(<BaseLoadingOverlay isLoading />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
