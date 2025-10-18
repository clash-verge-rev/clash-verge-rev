import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseEmpty } from "@/components/base/base-empty";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `i18n:${key}`,
  }),
}));

describe("BaseEmpty", () => {
  it("renders with default translation key and icon", () => {
    render(<BaseEmpty />);

    expect(screen.getByText("i18n:Empty")).toBeInTheDocument();
    expect(screen.getByTestId("InboxRoundedIcon")).toBeInTheDocument();
  });

  it("renders custom text and extra content", () => {
    render(<BaseEmpty text="custom.key" extra={<span>more</span>} />);

    expect(screen.getByText("i18n:custom.key")).toBeInTheDocument();
    expect(screen.getByText("more")).toBeInTheDocument();
  });
});
