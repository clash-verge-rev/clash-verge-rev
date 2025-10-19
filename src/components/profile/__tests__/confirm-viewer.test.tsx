import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmViewer } from "@/components/profile/confirm-viewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const renderConfirmViewer = (props: ComponentProps<typeof ConfirmViewer>) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <ConfirmViewer {...props} />
    </ThemeProvider>,
  );

describe("ConfirmViewer", () => {
  it("renders title and message content when open", () => {
    renderConfirmViewer({
      open: true,
      title: "Remove profile",
      message: "Are you sure?",
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    });

    expect(
      screen.getByRole("heading", { name: "Remove profile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("invokes callbacks when Cancel and Confirm buttons are clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    renderConfirmViewer({
      open: true,
      title: "Delete",
      message: "Confirm delete",
      onClose,
      onConfirm,
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not render dialog content when closed", () => {
    renderConfirmViewer({
      open: false,
      title: "Hidden",
      message: "Should not show",
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
