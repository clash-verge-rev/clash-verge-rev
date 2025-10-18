import React from "react";
import { vi } from "vitest";

type SelectEvent = { target: { value: string } };

type BaseStyledSelectProps = {
  value: string;
  onChange: (event: SelectEvent) => void;
  children: React.ReactNode;
};

type BaseSearchBoxProps = {
  onSearch: (matcher: (value: string) => boolean, state?: unknown) => void;
};

type SelectController = {
  readonly lastProps: BaseStyledSelectProps | null;
  trigger: (value: string) => void;
  reset: () => void;
};

type SearchController = {
  readonly handler: BaseSearchBoxProps["onSearch"] | null;
  trigger: (matcher: (value: string) => boolean, state?: unknown) => void;
  reset: () => void;
};

const selectState: { props: BaseStyledSelectProps | null } = { props: null };
const searchState: { handler: BaseSearchBoxProps["onSearch"] | null } = {
  handler: null,
};

export const baseStyledSelectController: SelectController = {
  get lastProps() {
    return selectState.props;
  },
  trigger(value: string) {
    selectState.props?.onChange({ target: { value } });
  },
  reset() {
    selectState.props = null;
  },
};

export const baseSearchBoxController: SearchController = {
  get handler() {
    return searchState.handler;
  },
  trigger(matcher: (value: string) => boolean, state?: unknown) {
    searchState.handler?.(matcher, state);
  },
  reset() {
    searchState.handler = null;
  },
};

vi.mock("@/components/base/base-styled-select", () => ({
  BaseStyledSelect: ({ value, onChange, children }: BaseStyledSelectProps) => {
    selectState.props = { value, onChange, children };
    const childElements: React.ReactElement[] = [];

    if (Array.isArray(children)) {
      for (const child of children) {
        if (React.isValidElement(child)) {
          childElements.push(child);
        }
      }
    } else if (React.isValidElement(children)) {
      childElements.push(children);
    }

    return (
      <div
        data-testid="base-styled-select"
        data-value={value}
        style={{ display: "inline-flex", gap: 4 }}
      >
        {childElements.map((child, index) => {
          const elementProps = child.props as {
            value?: string;
            children?: React.ReactNode;
          };
          const optionValue = elementProps.value ?? String(index);
          return (
            <button
              type="button"
              data-testid={`base-styled-select-option-${optionValue}`}
              key={optionValue}
              onClick={() => {
                baseStyledSelectController.trigger(optionValue);
              }}
            >
              {elementProps.children}
            </button>
          );
        })}
      </div>
    );
  },
}));

vi.mock("@/components/base/base-search-box", () => ({
  BaseSearchBox: ({ onSearch }: BaseSearchBoxProps) => {
    searchState.handler = onSearch;
    return <div data-testid="base-search-box">search-box</div>;
  },
}));
