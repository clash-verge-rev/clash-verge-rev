import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";
import {
  baseSearchBoxController,
  baseStyledSelectController,
} from "@/test/utils/base-controls-test-utils";

const toggleLogEnabledMock = vi.fn();
const refreshGetClashLogMock = vi.fn();

let mockClashLogState: { enable: boolean; logFilter: string };
let setClashLogMock: ReturnType<typeof vi.fn>;
let mockLogData: Array<{
  time?: string;
  type: string;
  payload: string;
}>;

vi.mock("@/components/log/log-item", () => ({
  default: ({ value }: { value: { payload: string } }) => (
    <div data-testid={`log-item-${value.payload}`}>{value.payload}</div>
  ),
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: any[];
    itemContent: (index: number, item: any) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data?.map((item, index) => (
        <div
          data-testid="virtuoso-row"
          key={item?.payload ?? `log-row-${index}`}
        >
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/hooks/use-log-data-new", () => ({
  useLogData: () => ({
    response: { data: mockLogData },
    refreshGetClashLog: refreshGetClashLogMock,
  }),
}));

vi.mock("@/services/states", () => ({
  useClashLog: () => [mockClashLogState, setClashLogMock] as const,
}));

vi.mock("@/services/global-log-service", () => ({
  toggleLogEnabled: (...args: Parameters<typeof toggleLogEnabledMock>) =>
    toggleLogEnabledMock(...args),
}));

const LogPageModule = await import("@/pages/logs");
const LogPage = LogPageModule.default;

describe("LogPage", () => {
  beforeEach(() => {
    toggleLogEnabledMock.mockReset();
    refreshGetClashLogMock.mockReset();
    setClashLogMock = vi.fn((updater: any) => {
      mockClashLogState =
        typeof updater === "function" ? updater(mockClashLogState) : updater;
    });
    mockClashLogState = { enable: true, logFilter: "all" };
    mockLogData = [];
    baseStyledSelectController.reset();
    baseSearchBoxController.reset();
  });

  it("renders empty state when no logs are available", () => {
    render(<LogPage />);

    expect(screen.getByTestId("base-page-title")).toHaveTextContent("Logs");
    expect(screen.getByTestId("base-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("virtuoso")).not.toBeInTheDocument();
  });

  it("renders log items and filters via search matcher", () => {
    mockLogData = [
      {
        time: "2025-10-18T12:00:00Z",
        type: "info",
        payload: "first payload",
      },
      {
        time: "2025-10-18T12:01:00Z",
        type: "debug",
        payload: "second payload",
      },
    ];

    render(<LogPage />);

    expect(screen.getByTestId("virtuoso")).toBeInTheDocument();
    expect(screen.getByTestId("log-item-first payload")).toBeInTheDocument();
    expect(screen.getByTestId("log-item-second payload")).toBeInTheDocument();

    act(() => {
      baseSearchBoxController.trigger((value) => value.includes("second"), {});
    });

    expect(
      screen.queryByTestId("log-item-first payload"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("log-item-second payload")).toBeInTheDocument();
  });

  it("changes log level via select and updates state", async () => {
    const user = userEvent.setup();
    render(<LogPage />);

    expect(baseStyledSelectController.lastProps).not.toBeNull();

    await user.click(screen.getByText("INFO"));

    expect(setClashLogMock).toHaveBeenCalled();
    expect(mockClashLogState.logFilter).toBe("info");
  });

  it("toggles log streaming and flips enable flag", async () => {
    toggleLogEnabledMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LogPage />);

    const toggleButton = screen.getByTitle("Pause");
    await user.click(toggleButton);

    expect(toggleLogEnabledMock).toHaveBeenCalledTimes(1);
    expect(mockClashLogState.enable).toBe(false);
  });

  it("triggers refresh when Clear is clicked", async () => {
    const user = userEvent.setup();
    render(<LogPage />);

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(refreshGetClashLogMock).toHaveBeenCalledWith(true);
  });
});
