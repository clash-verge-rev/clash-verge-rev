import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RuleItem from "../rule-item";

type RuleItemValue = {
  payload: string;
  type: string;
  proxy: string;
};

const createRule = (overrides: Partial<RuleItemValue> = {}): RuleItemValue => ({
  payload: "DOMAIN-SUFFIX,example.com",
  type: "DOMAIN-SUFFIX",
  proxy: "ProxyA",
  ...overrides,
});

describe("RuleItem", () => {
  it("renders the provided rule information", () => {
    render(<RuleItem index={3} value={createRule() as any} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("DOMAIN-SUFFIX,example.com")).toBeInTheDocument();
    expect(screen.getByText("DOMAIN-SUFFIX")).toBeInTheDocument();
    expect(screen.getByText("ProxyA")).toBeInTheDocument();
  });

  it("falls back to a dash when the payload is empty", () => {
    render(<RuleItem index={1} value={createRule({ payload: "" }) as any} />);

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("applies special colors for DIRECT and REJECT rules", () => {
    const { rerender } = render(
      <RuleItem index={9} value={createRule({ proxy: "DIRECT" }) as any} />,
    );

    expect(getComputedStyle(screen.getByText("DIRECT")).color).toBe(
      "rgba(0, 0, 0, 0.87)",
    );

    rerender(
      <RuleItem index={9} value={createRule({ proxy: "REJECT" }) as any} />,
    );

    expect(getComputedStyle(screen.getByText("REJECT")).color).toBe(
      "rgb(211, 47, 47)",
    );
  });
});
