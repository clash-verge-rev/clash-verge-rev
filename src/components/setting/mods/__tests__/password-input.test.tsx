import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { PasswordInput } from "../password-input";

describe("PasswordInput", () => {
  it("submits the entered password when the confirm button is pressed", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<PasswordInput onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input).toHaveFocus();

    await user.type(input, "secret");
    expect(input).toHaveValue("secret");

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith("secret");
  });

  it("submits the entered password when Enter is pressed in the text field", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<PasswordInput onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Password") as HTMLInputElement;
    await user.type(input, "topsecret{enter}");

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("topsecret"));
  });
});
