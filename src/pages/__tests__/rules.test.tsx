import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchState } from "@/components/base/base-search-box";

const refreshRulesMock = vi.fn();
const refreshRuleProvidersMock = vi.fn();
const useVisibilityMock = vi.fn();
const scrollToMock = vi.fn();

let latestRules: IRuleItem[] = [];
let scrollHandler: ((event: { target: { scrollTop: number } }) => void) | null =
  null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/base", () => ({
  BasePage: ({
    title,
    header,
    children,
  }: {
    title?: ReactNode;
    header?: ReactNode;
    children?: ReactNode;
  }) => (
    <div data-testid="base-page">
      <div data-testid="base-page-title">{title}</div>
      <div data-testid="base-page-header">{header}</div>
      <div data-testid="base-page-content">{children}</div>
    </div>
  ),
  BaseEmpty: () => <div data-testid="base-empty">empty</div>,
}));

vi.mock("@/components/base/base-search-box", () => ({
  BaseSearchBox: ({
    onSearch,
  }: {
    onSearch: (match: (content: string) => boolean, state: SearchState) => void;
  }) => (
    <input
      data-testid="rules-search"
      type="search"
      onChange={(event) => {
        const keyword = event.target.value.toLowerCase();
        onSearch((content) => content.toLowerCase().includes(keyword), {
          text: keyword,
        } as SearchState);
      }}
    />
  ),
}));

vi.mock("@/components/rule/provider-button", () => ({
  ProviderButton: () => (
    <button type="button" data-testid="provider-button">
      provider
    </button>
  ),
}));

vi.mock("@/components/rule/rule-item", () => ({
  default: ({ index, value }: { index: number; value: IRuleItem }) => (
    <div data-testid={`rule-item-${index}`}>{value.payload}</div>
  ),
}));

vi.mock("@/components/layout/scroll-top-button", () => ({
  ScrollTopButton: ({
    show,
    onClick,
  }: {
    show: boolean;
    onClick: () => void;
  }) =>
    show ? (
      <button type="button" data-testid="scroll-top" onClick={onClick}>
        scroll-top
      </button>
    ) : null,
}));

vi.mock("@/hooks/use-visibility", () => ({
  useVisibility: () => useVisibilityMock(),
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: () => ({
    rules: latestRules,
    refreshRules: refreshRulesMock,
    refreshRuleProviders: refreshRuleProvidersMock,
  }),
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(
    (
      {
        data,
        itemContent,
        scrollerRef,
      }: {
        data: IRuleItem[];
        itemContent: (index: number, item: IRuleItem) => ReactNode;
        scrollerRef?: (
          ref: {
            addEventListener: (
              event: string,
              handler: (event: { target: { scrollTop: number } }) => void,
            ) => void;
          } | null,
        ) => void;
      },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({
        scrollTo: scrollToMock,
      }));

      useEffect(() => {
        if (!scrollerRef) return;
        const mockScroller = {
          addEventListener: (
            event: string,
            handler: (event: { target: { scrollTop: number } }) => void,
          ) => {
            if (event === "scroll") {
              scrollHandler = handler;
            }
          },
        };
        scrollerRef(mockScroller);
        return () => {
          scrollHandler = null;
        };
      }, [scrollerRef]);

      return (
        <div data-testid="virtuoso">
          {data.map((item, index) => (
            <div key={item.payload}>{itemContent(index, item)}</div>
          ))}
        </div>
      );
    },
  ),
  VirtuosoHandle: {},
}));

const RulesPageModule = await import("@/pages/rules");
const RulesPage = RulesPageModule.default;

describe("RulesPage", () => {
  beforeEach(() => {
    refreshRulesMock.mockClear();
    refreshRuleProvidersMock.mockClear();
    useVisibilityMock.mockReturnValue(true);
    latestRules = [
      { type: "DOMAIN", payload: "example.com", proxy: "DIRECT" },
      { type: "IP-CIDR", payload: "192.168.0.0/16", proxy: "REJECT" },
    ];
    scrollToMock.mockClear();
    scrollHandler = null;
  });

  it("refreshes rules and providers when visible and filters by search", async () => {
    const user = userEvent.setup();
    render(<RulesPage />);

    // Called twice due to visibility trigger
    expect(refreshRulesMock).toHaveBeenCalledTimes(2);
    expect(refreshRuleProvidersMock).toHaveBeenCalledTimes(2);

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("192.168.0.0/16")).toBeInTheDocument();

    const searchInput = screen.getByTestId("rules-search");
    await user.type(searchInput, "example");

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.queryByText("192.168.0.0/16")).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "no-match");

    expect(screen.queryByText("example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("192.168.0.0/16")).not.toBeInTheDocument();
    expect(screen.getByTestId("base-empty")).toBeInTheDocument();
  });

  it("shows scroll to top button when scrolled and triggers scrollTo", async () => {
    const user = userEvent.setup();
    render(<RulesPage />);

    expect(scrollHandler).not.toBeNull();
    scrollHandler?.({ target: { scrollTop: 50 } });
    expect(screen.queryByTestId("scroll-top")).toBeNull();

    scrollHandler?.({ target: { scrollTop: 150 } });
    const button = await screen.findByTestId("scroll-top");
    await user.click(button);

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });
});
