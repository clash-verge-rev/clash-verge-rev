import { ThemeProvider, createTheme } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Traffic } from "tauri-plugin-mihomo-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LayoutTraffic } from "@/components/layout/layout-traffic";

type TestTrafficRef = {
  appendData: ReturnType<typeof vi.fn>;
  toggleStyle: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  let verge: Partial<IVergeConfig> = {
    traffic_graph: true,
    enable_memory_usage: true,
  };
  let visible = true;
  let traffic: Traffic | undefined = { up: 1024, down: 2048 };
  let memory: { inuse?: number } | undefined = { inuse: 3072 };
  let graphRef: TestTrafficRef | null = null;

  return {
    getVerge: () => verge,
    setVerge: (value: Partial<IVergeConfig>) => {
      verge = value;
    },
    isVisible: () => visible,
    setVisible: (value: boolean) => {
      visible = value;
    },
    getTraffic: () => traffic,
    setTraffic: (value: Traffic | undefined) => {
      traffic = value;
    },
    getMemory: () => memory,
    setMemory: (value: { inuse?: number } | undefined) => {
      memory = value;
    },
    setGraphRef: (value: TestTrafficRef | null) => {
      graphRef = value;
    },
    getGraphRef: () => graphRef,
  };
});

vi.mock("@/components/common/traffic-error-boundary", () => ({
  LightweightTrafficErrorBoundary: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));

vi.mock("@/components/layout/traffic-graph", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const MockTrafficGraph = React.forwardRef<TestTrafficRef>((_, ref) => {
    const appendData = useRef(vi.fn());
    const toggleStyle = useRef(vi.fn());

    useImperativeHandle(ref, () => ({
      appendData: appendData.current,
      toggleStyle: toggleStyle.current,
    }));

    useEffect(() => {
      mocks.setGraphRef({
        appendData: appendData.current,
        toggleStyle: toggleStyle.current,
      });
      return () => {
        mocks.setGraphRef(null);
      };
    }, []);

    return <div data-testid="traffic-graph" />;
  });

  return {
    TrafficGraph: MockTrafficGraph,
  };
});

vi.mock("@/hooks/use-traffic-data", () => ({
  useTrafficData: () => ({
    response: {
      data: mocks.getTraffic(),
    },
  }),
}));

vi.mock("@/hooks/use-memory-data", () => ({
  useMemoryData: () => ({
    response: {
      data: mocks.getMemory(),
    },
  }),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({
    verge: mocks.getVerge(),
  }),
}));

vi.mock("@/hooks/use-visibility", () => ({
  useVisibility: () => mocks.isVisible(),
}));

vi.mock("@/utils/parse-traffic", async () => {
  const actual = await vi.importActual<typeof import("@/utils/parse-traffic")>(
    "@/utils/parse-traffic",
  );
  return {
    default: actual.default,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

const renderLayoutTraffic = () => {
  const theme = createTheme();
  const view = render(
    <ThemeProvider theme={theme}>
      <LayoutTraffic />
    </ThemeProvider>,
  );

  return { ...view, theme };
};

describe("LayoutTraffic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setVerge({
      traffic_graph: true,
      enable_memory_usage: true,
    });
    mocks.setVisible(true);
    mocks.setTraffic({ up: 1024, down: 2048 });
    mocks.setMemory({ inuse: 3072 });
  });

  afterEach(() => {
    mocks.setGraphRef(null);
  });

  it("renders graph when enabled and visible, and forwards append data", async () => {
    const { rerender, theme } = renderLayoutTraffic();

    expect(screen.getByTestId("traffic-graph")).toBeInTheDocument();

    const api = await waitFor(() => mocks.getGraphRef());
    expect(api).toBeTruthy();

    await waitFor(() => {
      expect(api?.appendData).toHaveBeenCalledWith({ up: 1024, down: 2048 });
    });

    api?.appendData.mockClear();
    api?.toggleStyle.mockClear();

    rerender(
      <ThemeProvider theme={theme}>
        <LayoutTraffic />
      </ThemeProvider>,
    );

    const wrapper = screen.getByTestId("traffic-graph").parentElement;
    expect(wrapper).toBeTruthy();

    fireEvent.click(wrapper as HTMLElement);
    expect(api?.toggleStyle).toHaveBeenCalled();
  });

  it("falls back when traffic graph disabled or page hidden", () => {
    mocks.setVerge({
      traffic_graph: false,
      enable_memory_usage: true,
    });
    const { rerender, theme } = renderLayoutTraffic();
    expect(screen.queryByTestId("traffic-graph")).toBeNull();

    mocks.setVerge({
      traffic_graph: true,
      enable_memory_usage: true,
    });
    mocks.setVisible(false);

    rerender(
      <ThemeProvider theme={theme}>
        <LayoutTraffic />
      </ThemeProvider>,
    );

    expect(screen.queryByTestId("traffic-graph")).toBeNull();
  });

  it("updates displayed metrics and toggles memory block", async () => {
    const view = renderLayoutTraffic();

    expect(screen.getByText("1.00")).toBeInTheDocument();
    expect(screen.getByText("2.00")).toBeInTheDocument();
    expect(screen.getByText("3.00")).toBeInTheDocument();
    expect(screen.getAllByText("KB/s").length).toBeGreaterThanOrEqual(2);

    mocks.setTraffic({ up: 4096, down: 0 });
    mocks.setMemory({ inuse: 0 });

    view.rerender(
      <ThemeProvider theme={view.theme}>
        <LayoutTraffic />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("4.00")).toBeInTheDocument();
    });
    expect(screen.getAllByText("KB/s").length).toBeGreaterThanOrEqual(1);

    mocks.setVerge({
      traffic_graph: true,
      enable_memory_usage: false,
    });

    view.rerender(
      <ThemeProvider theme={view.theme}>
        <LayoutTraffic />
      </ThemeProvider>,
    );

    expect(screen.queryByText("3.00")).toBeNull();
  });
});
