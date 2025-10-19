import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LogViewer } from "@/components/profile/log-viewer";

const { baseEmptySpy } = vi.hoisted(() => ({
  baseEmptySpy: vi.fn(() => <div data-testid="base-empty" />),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/base", () => ({
  BaseEmpty: baseEmptySpy,
}));

describe("LogViewer", () => {
  it("renders logs with associated level chips", () => {
    render(
      <LogViewer
        open={true}
        onClose={vi.fn()}
        logInfo={[
          ["info", "initialised"],
          ["error", "script failed"],
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Script Console" }),
    ).toBeInTheDocument();

    const logEntries = screen.getAllByText(/initialised|script failed/);
    expect(logEntries).toHaveLength(2);

    const chipLabels = screen.getAllByText(/info|error/);
    expect(chipLabels).toHaveLength(2);
  });

  it("falls back to BaseEmpty when there are no log entries", () => {
    baseEmptySpy.mockClear();

    render(<LogViewer open={true} onClose={vi.fn()} logInfo={[]} />);

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(baseEmptySpy).toHaveBeenCalledOnce();
  });

  it("invokes onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<LogViewer open={true} onClose={onClose} logInfo={[]} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
