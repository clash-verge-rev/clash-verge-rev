import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TooltipIcon } from "@/components/base/base-tooltip-icon";

const CustomIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg data-testid="custom-icon" {...props} />
);

describe("TooltipIcon", () => {
  it("displays tooltip content on hover", async () => {
    const user = userEvent.setup();

    render(<TooltipIcon title="Helpful hint" />);
    const button = screen.getByRole("button");

    await user.hover(button);
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful hint"),
    );

    await user.unhover(button);
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it("supports overriding the icon component", () => {
    render(<TooltipIcon title="Info" icon={CustomIcon} />);

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });
});
