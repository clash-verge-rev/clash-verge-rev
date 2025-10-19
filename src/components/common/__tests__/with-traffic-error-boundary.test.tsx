import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTrafficErrorBoundary } from "@/components/common/with-traffic-error-boundary";

const { trackTrafficBoundary, trackLightBoundary } = vi.hoisted(() => ({
  trackTrafficBoundary: vi.fn(),
  trackLightBoundary: vi.fn(),
}));

vi.mock("@/components/common/traffic-error-boundary", () => ({
  TrafficErrorBoundary: ({
    children,
    onError,
  }: {
    children: ReactNode;
    onError?: (error: Error, info: any) => void;
  }) => {
    trackTrafficBoundary(onError);
    return <div data-testid="traffic-boundary">{children}</div>;
  },
  LightweightTrafficErrorBoundary: ({
    children,
    onError,
  }: {
    children: ReactNode;
    onError?: (error: Error, info: any) => void;
  }) => {
    trackLightBoundary(onError);
    return <div data-testid="light-boundary">{children}</div>;
  },
}));

const BaseComponent = () => <span data-testid="wrapped">hello</span>;

describe("withTrafficErrorBoundary", () => {
  afterEach(() => {
    vi.clearAllMocks();
    trackTrafficBoundary.mockReset();
    trackLightBoundary.mockReset();
  });

  it("wraps component with standard TrafficErrorBoundary by default", () => {
    const Wrapped = withTrafficErrorBoundary(BaseComponent);

    expect(Wrapped.displayName).toBe("withTrafficErrorBoundary(BaseComponent)");

    render(<Wrapped />);

    expect(screen.getByTestId("traffic-boundary")).toBeInTheDocument();
    expect(screen.getByTestId("wrapped")).toBeInTheDocument();
    expect(trackTrafficBoundary).toHaveBeenCalledWith(undefined);
    expect(trackLightBoundary).not.toHaveBeenCalled();
  });

  it("uses lightweight boundary and forwards onError handler when requested", () => {
    const onError = vi.fn();
    const Wrapped = withTrafficErrorBoundary(BaseComponent, {
      lightweight: true,
      onError,
    });

    render(<Wrapped />);

    expect(screen.getByTestId("light-boundary")).toBeInTheDocument();
    expect(trackLightBoundary).toHaveBeenCalledWith(onError);
    expect(trackTrafficBoundary).not.toHaveBeenCalled();
  });
});
