import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { useVisibility } from "@/hooks/use-visibility";

const originalDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "visibilityState",
);

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
};

const TestComponent = () => {
  const isVisible = useVisibility();
  return <span data-testid="status">{isVisible ? "visible" : "hidden"}</span>;
};

describe("useVisibility", () => {
  beforeEach(() => {
    setVisibility("hidden");
  });

  afterAll(() => {
    if (originalDescriptor) {
      Object.defineProperty(document, "visibilityState", originalDescriptor);
    }
  });

  it("reflects document visibility changes", async () => {
    render(<TestComponent />);

    expect(screen.getByTestId("status")).toHaveTextContent("hidden");

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("visible"),
    );
  });

  it("switches to visible on focus and pointerdown events", async () => {
    render(<TestComponent />);

    expect(screen.getByTestId("status")).toHaveTextContent("hidden");

    document.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("visible"),
    );

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("hidden"),
    );

    document.dispatchEvent(new Event("pointerdown"));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("visible"),
    );
  });
});
