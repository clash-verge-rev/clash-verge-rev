import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LayoutItem } from "@/components/layout/layout-item";
import { useVerge } from "@/hooks/use-verge";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/hooks/use-verge", () => ({
  useVerge: vi.fn(),
}));

const useVergeMock = vi.mocked(useVerge);

const defaultInitialEntries = ["/home"];

type WrapperProps = PropsWithChildren<{ initialEntries?: string[] }>;

const Wrapper = ({
  initialEntries = defaultInitialEntries,
  children,
}: WrapperProps) => (
  <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
);

const createUseVergeValue = (
  overrides: Partial<NonNullable<ReturnType<typeof useVerge>["verge"]>>,
): ReturnType<typeof useVerge> =>
  ({
    verge: overrides as NonNullable<ReturnType<typeof useVerge>["verge"]>,
    mutateVerge: vi.fn(),
    patchVerge: vi.fn(),
  }) as ReturnType<typeof useVerge>;

describe("LayoutItem", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  it("navigates to target route when clicked", () => {
    useVergeMock.mockReturnValue(
      createUseVergeValue({ menu_icon: "monochrome" }),
    );

    render(
      <Wrapper>
        <LayoutItem
          to="/settings"
          icon={[<span key="mono">*</span>, <span key="color">#</span>]}
        >
          Settings
        </LayoutItem>
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });

  it("uses colorful icon variant when configured", () => {
    useVergeMock.mockReturnValue(
      createUseVergeValue({ menu_icon: "colorful" }),
    );

    render(
      <Wrapper>
        <LayoutItem
          to="/logs"
          icon={[<span key="mono">*</span>, <span key="color">#</span>]}
        >
          Logs
        </LayoutItem>
      </Wrapper>,
    );

    expect(screen.getByText("#")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
  });

  it("marks item as selected when route matches", () => {
    useVergeMock.mockReturnValue(createUseVergeValue({ menu_icon: "disable" }));

    const { getByRole } = render(
      <Wrapper initialEntries={["/logs"]}>
        <LayoutItem
          to="/logs"
          icon={[<span key="mono">*</span>, <span key="color">#</span>]}
        >
          Logs
        </LayoutItem>
      </Wrapper>,
    );

    const button = getByRole("button");
    expect(button.classList.contains("Mui-selected")).toBe(true);
  });
});
