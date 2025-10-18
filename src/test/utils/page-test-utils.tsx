import React from "react";
import { vi } from "vitest";

type BasePageProps = {
  title?: React.ReactNode;
  header?: React.ReactNode;
  children?: React.ReactNode;
};

const BasePageMock = ({ title, header, children }: BasePageProps) => (
  <div data-testid="base-page">
    <div data-testid="base-page-title">{title}</div>
    <div data-testid="base-page-header">{header}</div>
    <div data-testid="base-page-content">{children}</div>
  </div>
);

const BaseEmptyMock = ({ text }: { text?: React.ReactNode }) => (
  <div data-testid="base-empty">{text ?? "empty"}</div>
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/components/base", () => ({
  BasePage: BasePageMock,
  BaseEmpty: BaseEmptyMock,
}));

export { BasePageMock, BaseEmptyMock };
