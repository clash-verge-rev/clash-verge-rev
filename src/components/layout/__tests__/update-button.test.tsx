import { fireEvent, render, screen } from "@testing-library/react";
import useSWR from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateButton } from "@/components/layout/update-button";
import { useVerge } from "@/hooks/use-verge";

vi.mock("@mui/x-data-grid/esm/index.css", () => ({}));
vi.mock("@mui/x-data-grid", () => ({}));

const mockOpen = vi.fn();

async function setupUpdateViewerMock() {
  const React = await import("react");
  return {
    UpdateViewer: React.forwardRef((_props, ref) => {
      if (typeof ref === "function") {
        ref({
          open: mockOpen,
        });
      } else if (ref) {
        (ref as any).current = {
          open: mockOpen,
        };
      }

      return React.createElement("div", { "data-testid": "update-viewer" });
    }),
  };
}

vi.mock("../setting/mods/update-viewer", setupUpdateViewerMock);
vi.mock("@/components/setting/mods/update-viewer", setupUpdateViewerMock);

vi.mock("@/hooks/use-verge", () => ({
  useVerge: vi.fn(),
}));

vi.mock("swr", () => {
  return {
    default: vi.fn(),
  };
});

const useVergeMock = vi.mocked(useVerge);
const useSWRMock = vi.mocked(useSWR);

const createUseVergeValue = (
  overrides: Partial<NonNullable<ReturnType<typeof useVerge>["verge"]>>,
): ReturnType<typeof useVerge> =>
  ({
    verge: overrides as NonNullable<ReturnType<typeof useVerge>["verge"]>,
    mutateVerge: vi.fn(),
    patchVerge: vi.fn(),
  }) as ReturnType<typeof useVerge>;

describe("UpdateButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when update info is unavailable", () => {
    useVergeMock.mockReturnValue(
      createUseVergeValue({ auto_check_update: true }),
    );
    useSWRMock.mockReturnValue({ data: { available: false } } as any);

    const { container } = render(<UpdateButton />);

    expect(container).toBeEmptyDOMElement();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("renders button and triggers viewer when update is available", () => {
    useVergeMock.mockReturnValue(
      createUseVergeValue({ auto_check_update: true }),
    );
    useSWRMock.mockReturnValue({
      data: { available: true },
    } as any);

    render(<UpdateButton className="cta" />);

    const button = screen.getByRole("button", { name: "New" });
    expect(button).toHaveClass("cta");
    expect(screen.getByTestId("update-viewer")).toBeInTheDocument();

    fireEvent.click(button);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("skips SWR fetch when auto_check_update is falsy", () => {
    useVergeMock.mockReturnValue(
      createUseVergeValue({ auto_check_update: false }),
    );
    useSWRMock.mockReturnValue({ data: null } as any);

    const { container } = render(<UpdateButton />);

    expect(container).toBeEmptyDOMElement();
    expect(useSWRMock).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.any(Object),
    );
  });
});
