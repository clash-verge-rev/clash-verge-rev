import { ThemeProvider, createTheme } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EnhancedCanvasTrafficGraph,
  type EnhancedCanvasTrafficGraphRef,
} from "@/components/home/enhanced-canvas-traffic-graph";

const mocks = vi.hoisted(() => {
  const initialPoints = [
    { up: 1024, down: 512, timestamp: 1_700_000_000_000 },
    { up: 2048, down: 1024, timestamp: 1_700_000_030_000 },
  ];

  const getDataForTimeRange = vi.fn(() => initialPoints);

  return {
    dataPoints: initialPoints,
    samplerStats: { compressedBufferSize: 0 },
    getDataForTimeRange,
    setDataPoints(points: typeof initialPoints) {
      this.dataPoints = points;
    },
    setSamplerStats(stats: { compressedBufferSize: number }) {
      this.samplerStats = stats;
    },
  };
});

vi.mock("@/hooks/use-traffic-monitor", () => ({
  useTrafficGraphDataEnhanced: () => ({
    dataPoints: mocks.dataPoints,
    getDataForTimeRange: mocks.getDataForTimeRange,
    samplerStats: mocks.samplerStats,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key.includes("{{time}}") && options?.time != null) {
        return `${options.time} Minutes`;
      }
      return key;
    },
  }),
}));

const createContextStub = () => {
  const gradient = { addColorStop: vi.fn() };
  return {
    canvas: undefined as unknown as HTMLCanvasElement,
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 12 })),
    createLinearGradient: vi.fn(() => gradient),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
    textAlign: "left",
    textBaseline: "alphabetic",
    font: "",
    fillStyle: "#000",
  };
};

const renderGraph = () => {
  const theme = createTheme();
  const node = (
    <ThemeProvider theme={theme}>
      <EnhancedCanvasTrafficGraph />
    </ThemeProvider>
  );

  return render(node);
};

const RefHarness = ({
  onReady,
}: {
  onReady: (ref: EnhancedCanvasTrafficGraphRef | null) => void;
}) => {
  const ref = useRef<EnhancedCanvasTrafficGraphRef>(null);

  useEffect(() => {
    onReady(ref.current);
  }, [onReady]);

  return <EnhancedCanvasTrafficGraph ref={ref} />;
};

describe("EnhancedCanvasTrafficGraph", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn>;
  const originalDevicePixelRatio = window.devicePixelRatio;

  beforeEach(() => {
    mocks.getDataForTimeRange.mockImplementation(() => mocks.dataPoints);
    Object.defineProperty(window, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype as any, "getContext")
      .mockImplementation(function getContext(this: HTMLCanvasElement) {
        const ctx = createContextStub();
        ctx.canvas = this;
        return ctx as unknown as CanvasRenderingContext2D;
      });

    getBoundingClientRectSpy = vi
      .spyOn(HTMLCanvasElement.prototype as any, "getBoundingClientRect")
      .mockReturnValue({
        width: 320,
        height: 160,
        top: 0,
        left: 0,
        bottom: 160,
        right: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    getContextSpy.mockRestore();
    getBoundingClientRectSpy.mockRestore();
    Object.defineProperty(window, "devicePixelRatio", {
      value: originalDevicePixelRatio,
      configurable: true,
    });
  });

  it("renders initial stats and updates display data", async () => {
    renderGraph();

    await waitFor(() => {
      expect(screen.getByText("Points: 2 | Compressed: 0")).toBeInTheDocument();
    });

    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Smooth")).toBeInTheDocument();
    expect(screen.getByText("10 Minutes")).toBeInTheDocument();
  });

  it("cycles time range when time label is clicked", async () => {
    renderGraph();

    const button = await screen.findByText("10 Minutes");

    fireEvent.click(button);
    expect(await screen.findByText("1 Minutes")).toBeInTheDocument();

    fireEvent.click(screen.getByText("1 Minutes"));
    expect(await screen.findByText("5 Minutes")).toBeInTheDocument();

    fireEvent.click(screen.getByText("5 Minutes"));
    expect(await screen.findByText("10 Minutes")).toBeInTheDocument();
  });

  it("exposes toggleStyle on ref to switch render mode", async () => {
    let api: EnhancedCanvasTrafficGraphRef | null = null;
    const theme = createTheme();
    render(
      <ThemeProvider theme={theme}>
        <RefHarness onReady={(ref) => (api = ref)} />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(api).not.toBeNull();
    });

    expect(screen.getByText("Smooth")).toBeInTheDocument();

    const instance = api as EnhancedCanvasTrafficGraphRef | null;
    if (!instance) {
      throw new Error("expected traffic graph ref");
    }

    instance.toggleStyle();
    await waitFor(() => {
      expect(screen.getByText("Linear")).toBeInTheDocument();
    });
  });
});
