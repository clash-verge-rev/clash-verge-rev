import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BaseDialog } from "@/components/base/base-dialog";

describe("BaseDialog", () => {
  it("renders title, content, and reacts to action buttons", async () => {
    const user = userEvent.setup();
    const onOk = vi.fn();
    const onCancel = vi.fn();

    render(
      <BaseDialog
        open
        title="Dialog Title"
        okBtn="Confirm"
        cancelBtn="Cancel"
        onOk={onOk}
        onCancel={onCancel}
      >
        <p>Dialog body</p>
      </BaseDialog>,
    );

    expect(
      screen.getByRole("heading", { name: "Dialog Title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dialog body")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("allows hiding footer actions", () => {
    const { queryByRole } = render(
      <BaseDialog open title="No footer" disableFooter>
        <span>Content</span>
      </BaseDialog>,
    );

    expect(queryByRole("button")).toBeNull();
  });
});
