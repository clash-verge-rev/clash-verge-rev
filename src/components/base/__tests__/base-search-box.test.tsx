import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { BaseSearchBox } from "@/components/base/base-search-box";

vi.mock("@/assets/image/component/match_case.svg?react", () => ({
  default: forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
    (props, ref) => <svg ref={ref} data-testid="match-case-icon" {...props} />,
  ),
}));

vi.mock("@/assets/image/component/match_whole_word.svg?react", () => ({
  default: forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
    (props, ref) => (
      <svg ref={ref} data-testid="match-whole-word-icon" {...props} />
    ),
  ),
}));

vi.mock("@/assets/image/component/use_regular_expression.svg?react", () => ({
  default: forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
    (props, ref) => <svg ref={ref} data-testid="use-regex-icon" {...props} />,
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `i18n:${key}`,
  }),
}));

const getToggleIcons = () => {
  const matchCase = screen.getByTestId("match-case-icon");
  const matchWhole = screen.getByTestId("match-whole-word-icon");
  const regex = screen.getByTestId("use-regex-icon");

  return { matchCase, matchWhole, regex };
};

describe("BaseSearchBox", () => {
  it("invokes onSearch with matcher using current search text", async () => {
    const onSearch = vi.fn();
    render(<BaseSearchBox onSearch={onSearch} placeholder="find" />);

    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    const [, initialState] = onSearch.mock.calls.at(-1) ?? [];
    expect(initialState).toMatchObject({
      text: "",
      matchCase: false,
      matchWholeWord: false,
      useRegularExpression: false,
    });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Foo" } });

    const [matcher, state] = onSearch.mock.calls.at(-1);
    expect(state).toMatchObject({
      text: "Foo",
      matchCase: false,
      matchWholeWord: false,
      useRegularExpression: false,
    });
    expect(matcher("foo bar")).toBe(true);
    expect(matcher("bar baz")).toBe(false);
  });

  it("toggles search flags via icon clicks", async () => {
    const onSearch = vi.fn();
    render(<BaseSearchBox onSearch={onSearch} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Word" } });
    onSearch.mockClear();

    const { matchCase, matchWhole, regex } = getToggleIcons();

    fireEvent.click(matchCase);
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    let [, state] = onSearch.mock.calls.at(-1);
    expect(state.matchCase).toBe(true);
    expect(state.matchWholeWord).toBe(false);
    expect(state.useRegularExpression).toBe(false);

    onSearch.mockClear();
    fireEvent.click(matchWhole);
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    [, state] = onSearch.mock.calls.at(-1);
    expect(state.matchCase).toBe(true);
    expect(state.matchWholeWord).toBe(true);
    expect(state.useRegularExpression).toBe(false);

    onSearch.mockClear();
    fireEvent.click(regex);
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    [, state] = onSearch.mock.calls.at(-1);
    expect(state.useRegularExpression).toBe(true);
  });

  it("shows an error when enabling regex with invalid pattern", async () => {
    const onSearch = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<BaseSearchBox onSearch={onSearch} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "[" } });
    onSearch.mockClear();

    const { regex } = getToggleIcons();
    fireEvent.click(regex);

    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    const [, state] = onSearch.mock.calls.at(-1);
    expect(state.useRegularExpression).toBe(true);

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");

    warn.mockRestore();
  });
});
