import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/utils/parse-hotkey", () => ({
  parseHotkey: vi.fn(),
}));

import { parseHotkey } from "@/utils/parse-hotkey";

import { HotkeyInput } from "../hotkey-input";

const parseHotkeyMock = vi.mocked(parseHotkey);

describe("HotkeyInput", () => {
  beforeEach(() => {
    parseHotkeyMock.mockReset();
    parseHotkeyMock.mockImplementation((key: string) => key.toUpperCase());
  });

  it("renders initial hotkeys and separators", () => {
    render(<HotkeyInput value={["CTRL", "K"]} onChange={vi.fn()} />);

    expect(screen.getByText("CTRL")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
    const separators = screen.getAllByText("+", {
      selector: "span",
      exact: true,
    });
    expect(separators).toHaveLength(2);
    expect(separators[0]).toHaveAttribute("hidden");
    expect(separators[1]).not.toHaveAttribute("hidden");
  });

  it("collects unique keys while typing and emits them on key up", () => {
    const onChange = vi.fn();
    render(<HotkeyInput value={[]} onChange={onChange} />);

    const input = screen.getByRole("textbox");

    fireEvent.keyDown(input, { key: "Control" });
    expect(parseHotkeyMock).toHaveBeenLastCalledWith("Control");
    expect(screen.getAllByText("CONTROL")).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Control" });
    expect(screen.getAllByText("CONTROL")).toHaveLength(1);

    fireEvent.keyDown(input, { key: "k" });
    expect(screen.getByText("K")).toBeInTheDocument();

    fireEvent.keyUp(input);

    expect(onChange).toHaveBeenCalledWith(["CONTROL", "K"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores unidentified key values", () => {
    const onChange = vi.fn();
    parseHotkeyMock.mockReturnValueOnce("UNIDENTIFIED");

    render(<HotkeyInput value={[]} onChange={onChange} />);

    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Dead" });
    fireEvent.keyUp(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText("UNIDENTIFIED")).not.toBeInTheDocument();
  });

  it("clears the selection when delete is pressed", async () => {
    const onChange = vi.fn();
    render(<HotkeyInput value={["CTRL"]} onChange={onChange} />);

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    await userEvent.click(deleteButton);

    expect(onChange).toHaveBeenCalledWith([]);
    await waitFor(() =>
      expect(screen.queryByText("CTRL")).not.toBeInTheDocument(),
    );
  });
});
