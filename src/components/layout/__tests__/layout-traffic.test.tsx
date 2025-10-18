import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockAppendData = vi.fn();
const mockToggleStyle = vi.fn();

vi.mock("../traffic-graph", async () => {
  const React = await import("react");
  return {
    TrafficGraph: React.forwardRef((_, ref) => {
      const handlers = {
        appendData: mockAppendData,
        toggleStyle: mockToggleStyle,
      };
      if (typeof ref === "function") {
        ref(handlers);
      } else if (ref) {
        (ref as any).current = handlers;
      }

      return React.createElement("div", {
        "data-testid": "traffic-graph",
      });
    }),
  };
});

vi.mock("@/hooks/use-traffic-data", () => ({
  useTrafficData: vi.fn(),
}));

vi.mock("@/hooks/use-memory-data", () => ({
  useMemoryData: vi.fn(),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: vi.fn(),
}));

vi.mock("@/hooks/use-visibility", () => ({
  useVisibility: vi.fn(),
}));

vi.mock("@/utils/parse-traffic", () => ({
  default: vi.fn((value: number) => [`${value}`, "unit"]),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { useMemoryData } from "@/hooks/use-memory-data";
import { useTrafficData } from "@/hooks/use-traffic-data";
import { useVerge } from "@/hooks/use-verge";
import { useVisibility } from "@/hooks/use-visibility";

const useTrafficDataMock = vi.mocked(useTrafficData);
const useMemoryDataMock = vi.mocked(useMemoryData);
const useVergeMock = vi.mocked(useVerge);
const useVisibilityMock = vi.mocked(useVisibility);

const createUseVergeValue = (
  overrides: Partial<NonNullable<ReturnType<typeof useVerge>["verge"]>>,
): ReturnType<typeof useVerge> =>
  ({
    verge: overrides as NonNullable<ReturnType<typeof useVerge>["verge"]>,
    mutateVerge: vi.fn(),
    patchVerge: vi.fn(),
  }) as ReturnType<typeof useVerge>;

const arrange = ({
  traffic_graph = true,
  enable_memory_usage = true,
  visible = true,
}: {
  traffic_graph?: boolean;
  enable_memory_usage?: boolean;
  visible?: boolean;
} = {}) => {
  useVergeMock.mockReturnValue(
    createUseVergeValue({
      traffic_graph,
      enable_memory_usage,
    }),
  );
  useTrafficDataMock.mockReturnValue({
    response: { data: { up: 120, down: 340 } },
  } as any);
  useMemoryDataMock.mockReturnValue({
    response: { data: { inuse: 512 } },
  } as any);
  useVisibilityMock.mockReturnValue(visible);

  return render(<LayoutTraffic />);
};

describe("LayoutTraffic", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockAppendData.mockReset();
    mockToggleStyle.mockReset();
  });

  it("renders traffic and memory metrics using parsed values", () => {
    arrange();

    expect(screen.getByTitle(/Upload Speed/)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    const speedUnits = screen.getAllByText("unit/s");
    expect(speedUnits).toHaveLength(2);

    expect(screen.getByTitle(/Download Speed/)).toBeInTheDocument();
    expect(screen.getAllByText("340")[0]).toBeInTheDocument();

    expect(screen.getByTitle(/Memory Usage/)).toBeInTheDocument();
    expect(screen.getByText("512")).toBeInTheDocument();

    expect(mockAppendData).toHaveBeenCalledWith({ up: 120, down: 340 });
  });

  it("hides the graph when disabled or the page is not visible", () => {
    arrange({ traffic_graph: false });
    expect(screen.queryByTestId("traffic-graph")).not.toBeInTheDocument();
    expect(mockAppendData).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAppendData.mockReset();
    mockToggleStyle.mockReset();

    arrange({ visible: false });
    expect(screen.queryByTestId("traffic-graph")).not.toBeInTheDocument();
    expect(mockAppendData).not.toHaveBeenCalled();
  });

  it("omits memory usage when disabled in configuration", () => {
    arrange({ enable_memory_usage: false });

    expect(screen.queryByText("Memory Usage")).not.toBeInTheDocument();
  });
});
