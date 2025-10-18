import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseLoading } from "@/components/base/base-loading";

describe("BaseLoading", () => {
  it("renders three loading items", () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { container } = render(<BaseLoading />);

    const root = container.firstElementChild;
    expect(root?.childElementCount).toBe(3);

    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
