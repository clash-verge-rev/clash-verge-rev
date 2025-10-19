import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LogItem from "@/components/log/log-item";

const searchDefaults = {
  matchCase: false,
  matchWholeWord: false,
  useRegularExpression: false,
} as const;

describe("LogItem", () => {
  it("highlights matched segments across log fields", () => {
    const value: ILogItem = {
      time: "err",
      type: "ERR",
      payload: "err",
    };

    const { container } = render(
      <LogItem
        value={value}
        searchState={{ text: "err", ...searchDefaults }}
      />,
    );

    const highlights = Array.from(container.querySelectorAll(".highlight")).map(
      (node) => node.textContent,
    );

    expect(highlights).toEqual(["err", "ERR", "err"]);
  });

  it("falls back to literal highlighting when regex is invalid", () => {
    const value: ILogItem = {
      time: "",
      type: "info",
      payload: "[payload]",
    };

    const { container } = render(
      <LogItem
        value={value}
        searchState={{
          text: "[",
          matchCase: false,
          matchWholeWord: false,
          useRegularExpression: true,
        }}
      />,
    );

    const highlights = container.querySelectorAll(".highlight");

    expect(highlights).toHaveLength(1);
    expect(highlights[0].textContent).toBe("[");
  });
});
