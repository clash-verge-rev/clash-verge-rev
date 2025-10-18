import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EnhancedTrafficStats } from "@/components/home/enhanced-traffic-stats";

const { translationMock } = vi.hoisted(() => ({
  translationMock: { t: (key: string) => key },
}));

const { vergeOptions } = vi.hoisted(() => ({
  vergeOptions: { traffic_graph: true },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => translationMock,
}));

vi.mock("@/components/common/traffic-error-boundary", () => ({
  TrafficErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="traffic-boundary">{children}</div>
  ),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({
    verge: { traffic_graph: vergeOptions.traffic_graph },
  }),
}));

vi.mock("@/hooks/use-visibility", () => ({
  useVisibility: () => true,
}));

vi.mock("@/hooks/use-traffic-data", () => ({
  useTrafficData: () => ({
    response: { data: { up: 1024, down: 2048 } },
  }),
}));

vi.mock("@/hooks/use-memory-data", () => ({
  useMemoryData: () => ({
    response: { data: { inuse: 4096 } },
  }),
}));

vi.mock("@/hooks/use-connection-data", () => ({
  useConnectionData: () => ({
    response: {
      data: {
        connections: { length: 5 },
        uploadTotal: 10_485_760,
        downloadTotal: 15_728_640,
      },
    },
  }),
}));

vi.mock("@/components/home/enhanced-canvas-traffic-graph", () => ({
  EnhancedCanvasTrafficGraph: () => <div data-testid="traffic-graph-canvas" />,
  __esModule: true,
}));

describe("EnhancedTrafficStats", () => {
  it("renders the traffic graph and stat cards with formatted values", () => {
    render(<EnhancedTrafficStats />);

    expect(screen.getByTestId("traffic-boundary")).toBeInTheDocument();
    expect(screen.getByTestId("traffic-graph-canvas")).toBeInTheDocument();

    const uploadCard = screen.getByText("Upload Speed").closest("div");
    expect(uploadCard).not.toBeNull();
    expect(within(uploadCard!).getByText("1.00")).toBeInTheDocument();
    expect(within(uploadCard!).getByText("KB/s")).toBeInTheDocument();

    const downloadCard = screen.getByText("Download Speed").closest("div");
    expect(downloadCard).not.toBeNull();
    expect(within(downloadCard!).getByText("2.00")).toBeInTheDocument();
    expect(within(downloadCard!).getByText("KB/s")).toBeInTheDocument();

    expect(screen.getByText("Active Connections")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    const uploadedCard = screen.getByText("Uploaded").closest("div");
    expect(uploadedCard).not.toBeNull();
    expect(
      within(uploadedCard!).getByText((content) =>
        /^\d+(\.\d+)?$/.test(content),
      ),
    ).toBeInTheDocument();
    expect(within(uploadedCard!).getByText("MB")).toBeInTheDocument();

    const downloadedCard = screen.getByText("Downloaded").closest("div");
    expect(downloadedCard).not.toBeNull();
    expect(
      within(downloadedCard!).getByText((content) =>
        /^\d+(\.\d+)?$/.test(content),
      ),
    ).toBeInTheDocument();
    expect(within(downloadedCard!).getByText("MB")).toBeInTheDocument();

    const memoryCard = screen.getByText("Memory Usage").closest("div");
    expect(memoryCard).not.toBeNull();
    expect(
      within(memoryCard!).getByText((content) => /^\d+(\.\d+)?$/.test(content)),
    ).toBeInTheDocument();
    expect(within(memoryCard!).getByText("KB")).toBeInTheDocument();
  });

  it("omits the graph when feature flag disables it", () => {
    vergeOptions.traffic_graph = false;
    render(<EnhancedTrafficStats />);

    expect(screen.queryByTestId("traffic-graph-canvas")).toBeNull();
    expect(screen.getByText("Upload Speed")).toBeInTheDocument();

    vergeOptions.traffic_graph = true;
  });
});
