import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorInfo } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LightweightTrafficErrorBoundary,
  TrafficErrorBoundary,
} from "@/components/common/traffic-error-boundary";
import { withTrafficErrorBoundary } from "@/components/common/with-traffic-error-boundary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `i18n:${key}`,
  }),
}));

const renderWithTheme = (ui: React.ReactElement) => {
  const theme = createTheme({ palette: { mode: "light" } });
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

const ProblemChild = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div>safe child</div>;
};

describe("TrafficErrorBoundary", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    consoleError.mockClear();
    consoleLog.mockClear();
    consoleWarn.mockClear();
  });

  it("renders default fallback UI and supports retry workflow", async () => {
    const user = userEvent.setup();

    renderWithTheme(
      <TrafficErrorBoundary>
        <ProblemChild />
      </TrafficErrorBoundary>,
    );

    expect(
      await screen.findByRole("button", { name: "i18n:Retry" }),
    ).toBeInTheDocument();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");

    await user.click(screen.getByRole("button", { name: "i18n:Retry" }));
    expect(screen.getByText(/i18n:Retry attempts: 1\/3/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "i18n:Show Details" }));
    expect(
      screen.getByRole("button", { name: "i18n:Hide Details" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "i18n:Hide Details" }));
  });

  it("invokes onError callback with error details", () => {
    const onError = vi.fn();

    renderWithTheme(
      <TrafficErrorBoundary onError={onError}>
        <ProblemChild />
      </TrafficErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom");
    expect((info as ErrorInfo).componentStack).toBeTruthy();
  });

  it("renders custom fallback component when provided", () => {
    renderWithTheme(
      <TrafficErrorBoundary fallbackComponent={<div>custom fallback</div>}>
        <ProblemChild />
      </TrafficErrorBoundary>,
    );

    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });

  afterAll(() => {
    consoleError.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });
});

describe("LightweightTrafficErrorBoundary", () => {
  it("renders lightweight fallback when child throws", () => {
    renderWithTheme(
      <LightweightTrafficErrorBoundary>
        <ProblemChild />
      </LightweightTrafficErrorBoundary>,
    );

    expect(screen.getByText("Traffic data unavailable")).toBeInTheDocument();
  });
});

describe("withTrafficErrorBoundary HOC", () => {
  it("wraps component with default error boundary behaviour", () => {
    const BaseComponent = () => <div>base component</div>;
    const Wrapped = withTrafficErrorBoundary(BaseComponent);

    renderWithTheme(<Wrapped />);

    expect(screen.getByText("base component")).toBeInTheDocument();
  });

  it("uses standard boundary when component throws and calls onError", async () => {
    const ThrowingComponent = () => {
      throw new Error("fail");
    };
    const onError = vi.fn();
    const Wrapped = withTrafficErrorBoundary(ThrowingComponent, {
      onError,
    });

    renderWithTheme(<Wrapped />);

    expect(
      await screen.findByRole("button", { name: "i18n:Retry" }),
    ).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("uses lightweight boundary when option provided", () => {
    const ThrowingComponent = () => {
      throw new Error("fail");
    };
    const Wrapped = withTrafficErrorBoundary(ThrowingComponent, {
      lightweight: true,
    });

    renderWithTheme(<Wrapped />);

    expect(screen.getByText("Traffic data unavailable")).toBeInTheDocument();
  });
});
