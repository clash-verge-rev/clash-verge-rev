import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProxyGroupNavigator } from "@/components/proxy/proxy-group-navigator";

const renderNavigator = (
  proxyGroupNames: string[],
  onGroupLocation = vi.fn(),
) =>
  render(
    <ProxyGroupNavigator
      proxyGroupNames={proxyGroupNames}
      onGroupLocation={onGroupLocation}
    />,
  );

describe("ProxyGroupNavigator", () => {
  it("returns null when there are no valid group names", () => {
    const { container } = renderNavigator([]);

    expect(container.firstChild).toBeNull();
  });

  it("renders buttons for each processed group with the display character", () => {
    renderNavigator(["Alpha", "  ", "Beta", "🔥Fire", "Ωmega"]);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "A",
      "B",
      "🔥",
      "Ω",
    ]);
  });

  it("invokes onGroupLocation with the clicked group name", () => {
    const onGroupLocation = vi.fn();

    renderNavigator(["Alpha", "Beta"], onGroupLocation);

    fireEvent.click(screen.getByText("B"));

    expect(onGroupLocation).toHaveBeenCalledWith("Beta");
  });
});
