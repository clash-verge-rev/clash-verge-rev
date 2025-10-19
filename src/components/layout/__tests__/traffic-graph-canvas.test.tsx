import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TrafficGraph,
  type TrafficRef,
} from "@/components/layout/traffic-graph";

interface GraphHarnessProps {
  onReady: (api: TrafficRef | null) => void;
}

const GraphHarness = ({ onReady }: GraphHarnessProps) => {
  const ref = useRef<TrafficRef>(null);

  useEffect(() => {
    onReady(ref.current);
  }, [onReady]);

  return (
    <ThemeProvider theme={createTheme()}>
      <TrafficGraph ref={ref} />
    </ThemeProvider>
  );
};

type CanvasGradientMock = {
  addColorStop: ReturnType<typeof vi.fn>;
};

interface CanvasContextMock {
  canvas: HTMLCanvasElement;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  createLinearGradient: ReturnType<typeof vi.fn>;
  quadraticCurveTo: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setLineDash: ReturnType<typeof vi.fn>;
  globalAlpha: number;
  lineWidth: number;
  strokeStyle: string;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  fillStyle: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

let now = 0;
let rafId = 0;
let animationCallbacks: Map<number, FrameRequestCallback>;
let contextMocks: CanvasContextMock[];
let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;
let dateNowSpy: ReturnType<typeof vi.spyOn>;
let getContextSpy: ReturnType<typeof vi.spyOn>;

const flushAnimationFrame = (step = 100) => {
  now += step;
  const callbacks = Array.from(animationCallbacks.values());
  animationCallbacks.clear();
  callbacks.forEach((callback) => callback(now));
};

const createContextStub = (): CanvasContextMock => {
  const gradient: CanvasGradientMock = { addColorStop: vi.fn() };
  const mock: CanvasContextMock = {
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
    measureText: vi.fn(() => ({ width: 10 })),
    createLinearGradient: vi.fn(() => gradient),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "#000",
    lineCap: "round",
    lineJoin: "round",
    font: "",
    fillStyle: "#000",
    textAlign: "left",
    textBaseline: "alphabetic",
  };
  contextMocks.push(mock);
  return mock;
};

const renderGraph = (onReady: (api: TrafficRef | null) => void) => {
  return render(<GraphHarness onReady={onReady} />);
};

describe("TrafficGraph", () => {
  beforeEach(() => {
    now = 0;
    rafId = 0;
    animationCallbacks = new Map();
    contextMocks = [];

    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      const id = ++rafId;
      animationCallbacks.set(id, callback);
      return id;
    });

    cancelAnimationFrameMock = vi.fn((id: number) => {
      animationCallbacks.delete(id);
    });

    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype as any, "getContext")
      .mockImplementation(function getContext(this: HTMLCanvasElement) {
        const context = createContextStub();
        context.canvas = this;
        return context as unknown as CanvasRenderingContext2D;
      });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dateNowSpy.mockRestore();
    getContextSpy.mockRestore();
  });

  it("draws using bezier curves by default and consumes appended data", async () => {
    let api: TrafficRef | null = null;
    renderGraph((ref) => {
      api = ref;
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    await waitFor(() => expect(api).not.toBeNull());

    flushAnimationFrame();

    const context = contextMocks[0];
    if (!context) {
      throw new Error("expected canvas context");
    }

    if (!api) {
      throw new Error("TrafficGraph ref not initialized");
    }

    const instance = api as TrafficRef;

    context.quadraticCurveTo.mockClear();
    context.lineTo.mockClear();

    instance.appendData({ up: 4096, down: 2048 });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    flushAnimationFrame(100);

    expect(context.quadraticCurveTo).toHaveBeenCalled();
  });

  it("switches to straight line rendering after toggleStyle", async () => {
    let api: TrafficRef | null = null;
    renderGraph((ref) => {
      api = ref;
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    await waitFor(() => expect(api).not.toBeNull());

    flushAnimationFrame();

    const context = contextMocks[0];
    if (!context) {
      throw new Error("expected canvas context");
    }

    if (!api) {
      throw new Error("TrafficGraph ref not initialized");
    }

    const instance = api as TrafficRef;

    context.quadraticCurveTo.mockClear();
    context.lineTo.mockClear();

    instance.toggleStyle();
    flushAnimationFrame(100);

    expect(context.lineTo).toHaveBeenCalled();
    expect(context.quadraticCurveTo).not.toHaveBeenCalled();
  });

  it("cancels animation frames on unmount", async () => {
    const view = renderGraph(() => {});

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(requestAnimationFrameMock).toHaveBeenCalled();

    view.unmount();

    expect(cancelAnimationFrameMock).toHaveBeenCalled();
  });
});
