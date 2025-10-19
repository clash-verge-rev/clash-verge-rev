import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { WebUIItem } from "@/components/setting/mods/web-ui-item";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderItem = (props: React.ComponentProps<typeof WebUIItem>) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <WebUIItem {...props} />
    </ThemeProvider>,
  );

describe("WebUIItem", () => {
  it("highlights placeholders and invokes open/delete handlers", async () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const onChange = vi.fn();

    const { container } = renderItem({
      value: "http://%host:%port?secret=%secret",
      onChange,
      onOpenUrl: onOpen,
      onDelete,
    });

    const placeholders = container.querySelectorAll(".placeholder");
    expect(placeholders).toHaveLength(3);
    expect(placeholders[0]).toHaveTextContent("%host");
    expect(placeholders[1]).toHaveTextContent("%port");
    expect(placeholders[2]).toHaveTextContent("%secret");

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Open URL"));
    expect(onOpen).toHaveBeenCalledWith("http://%host:%port?secret=%secret");

    await user.click(screen.getByTitle("Delete"));
    expect(onDelete).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enters edit mode and saves updated value", async () => {
    const onChange = vi.fn();
    renderItem({
      value: "https://example.com",
      onChange,
    });

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Edit"));

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "https://updated.com");

    await user.click(screen.getByTitle("Save"));
    expect(onChange).toHaveBeenCalledWith("https://updated.com");
  });

  it("renders onlyEdit editor and supports cancel", async () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();

    renderItem({
      value: "",
      onlyEdit: true,
      onChange,
      onCancel,
    });

    const user = userEvent.setup();
    const input = screen.getByRole("textbox");
    await user.type(input, "https://added.com");

    await user.click(screen.getByTitle("Save"));
    expect(onChange).toHaveBeenCalledWith("https://added.com");

    await user.click(screen.getByTitle("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
