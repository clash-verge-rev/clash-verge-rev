import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingItem, SettingList } from "../setting-comp";

describe("SettingItem", () => {
  it("renders as a static list item when no click handler is provided", () => {
    render(
      <SettingItem label="Static Label" secondary="Secondary">
        <span data-testid="setting-children">child</span>
      </SettingItem>,
    );

    expect(screen.getByText("Static Label")).toBeInTheDocument();
    expect(screen.getByText("Secondary")).toBeInTheDocument();
    expect(screen.getByTestId("setting-children")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("invokes a synchronous click handler without showing a loader", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<SettingItem label="Clickable" onClick={onClick} />);

    const button = screen.getByRole("button", { name: /Clickable/ });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("displays a loader while waiting for an async handler", async () => {
    let resolveHandler: () => void = () => {};
    let callCount = 0;
    const onClick = async () => {
      callCount += 1;
      await new Promise<void>((resolve) => {
        resolveHandler = resolve;
      });
    };
    const user = userEvent.setup();

    render(<SettingItem label="Async Action" onClick={onClick} />);

    const button = screen.getByRole("button", { name: /Async Action/ });
    await user.click(button);

    expect(callCount).toBe(1);
    expect(button).toHaveClass("Mui-disabled");
    const loader = screen.getByRole("progressbar");
    expect(loader).toBeInTheDocument();

    resolveHandler();
    await waitFor(() => expect(button).not.toHaveClass("Mui-disabled"));
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
    );
  });
});

describe("SettingList", () => {
  it("renders a section header and forwards children", () => {
    render(
      <SettingList title="Section Title">
        <SettingItem label="Inner Item" />
      </SettingList>,
    );

    const list = screen.getByRole("list");
    expect(
      within(list).getByText("Section Title", { selector: "li, span, div" }),
    ).toBeInTheDocument();
    expect(within(list).getByText("Inner Item")).toBeInTheDocument();
  });
});
