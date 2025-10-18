import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";
import {
  baseSearchBoxController,
  baseStyledSelectController,
} from "@/test/utils/base-controls-test-utils";

const closeAllConnectionsMock = vi.fn();
const parseTrafficMock = vi.fn(
  (value: number | undefined) => `traffic-${value ?? 0}`,
);

let mockConnections: any;
let currentSetting: any;
const setSettingMock = vi.fn((updater: any) => {
  currentSetting =
    typeof updater === "function" ? updater(currentSetting) : updater;
});

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeAllConnections: (...args: Parameters<typeof closeAllConnectionsMock>) =>
    closeAllConnectionsMock(...args),
}));

vi.mock("@/components/connection/connection-item", () => ({
  ConnectionItem: ({
    value,
    onShowDetail,
  }: {
    value: any;
    onShowDetail: () => void;
  }) => (
    <div
      data-testid={`connection-item-${value.metadata.host}`}
      onClick={onShowDetail}
    >
      {value.metadata.host}
    </div>
  ),
}));

vi.mock("@/components/connection/connection-table", () => ({
  ConnectionTable: ({
    connections,
    onShowDetail,
  }: {
    connections: any[];
    onShowDetail: (value: any) => void;
  }) => (
    <table data-testid="connection-table">
      <tbody>
        {connections.map((conn, idx) => (
          <tr
            key={conn?.metadata?.host ?? `connection-${idx}`}
            onClick={() => onShowDetail(conn)}
          >
            <td>{conn?.metadata?.host}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock("@/components/connection/connection-detail", () => ({
  ConnectionDetail: forwardRef((_, ref) => {
    useImperativeHandle(ref, () => ({
      open: vi.fn(),
    }));
    return <div data-testid="connection-detail" />;
  }),
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: any[];
    itemContent: (index: number, value: any) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data?.map((item, index) => (
        <div data-testid="virtuoso-item" key={item.id ?? index}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/hooks/use-connection-data", () => ({
  useConnectionData: () => ({
    response: { data: mockConnections },
  }),
}));

vi.mock("@/hooks/use-visibility", () => ({
  useVisibility: () => true,
}));

vi.mock("@/services/states", () => ({
  useConnectionSetting: () => [currentSetting, setSettingMock] as const,
}));

vi.mock("@/utils/parse-traffic", () => ({
  __esModule: true,
  default: (value: number | undefined) => parseTrafficMock(value),
}));

const ConnectionsPageModule = await import("@/pages/connections");
const ConnectionsPage = ConnectionsPageModule.default;

describe("ConnectionsPage", () => {
  beforeEach(() => {
    closeAllConnectionsMock.mockReset();
    parseTrafficMock.mockClear();
    setSettingMock.mockImplementation((updater: any) => {
      currentSetting =
        typeof updater === "function" ? updater(currentSetting) : updater;
    });
    setSettingMock.mockClear();
    currentSetting = { layout: "list" };
    mockConnections = {
      uploadTotal: 0,
      downloadTotal: 0,
      connections: [],
    };
    baseStyledSelectController.reset();
    baseSearchBoxController.reset();
  });

  it("renders empty state when there are no connections", () => {
    render(<ConnectionsPage />);

    expect(parseTrafficMock).toHaveBeenCalledWith(0);
    expect(screen.getByText("Downloaded: traffic-0")).toBeInTheDocument();
    expect(screen.getByTestId("base-empty")).toBeInTheDocument();
  });

  it("renders list layout and filters via search matcher", async () => {
    mockConnections = {
      uploadTotal: 100,
      downloadTotal: 200,
      connections: [
        {
          id: "one",
          metadata: {
            host: "alpha.example.com",
            destinationIP: "10.0.0.1",
            process: "alpha",
          },
          start: "2025-10-18T12:00:00Z",
          curUpload: 10,
          curDownload: 5,
        },
        {
          id: "two",
          metadata: {
            host: "beta.example.com",
            destinationIP: "10.0.0.2",
            process: "beta",
          },
          start: "2025-10-18T12:01:00Z",
          curUpload: 20,
          curDownload: 15,
        },
      ],
    };

    render(<ConnectionsPage />);

    expect(screen.getByText("Downloaded: traffic-200")).toBeInTheDocument();
    expect(screen.getByText("Uploaded: traffic-100")).toBeInTheDocument();

    expect(
      screen.getByTestId("connection-item-beta.example.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("connection-item-alpha.example.com"),
    ).toBeInTheDocument();

    expect(baseSearchBoxController.handler).toBeTruthy();
    act(() => {
      baseSearchBoxController.trigger((value) => value.includes("beta"));
    });

    expect(
      screen.queryByTestId("connection-item-alpha.example.com"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("connection-item-beta.example.com"),
    ).toBeInTheDocument();
  });

  it("shows table layout when the persisted setting is table", () => {
    currentSetting = { layout: "table" };
    mockConnections = {
      uploadTotal: 50,
      downloadTotal: 75,
      connections: [
        {
          id: "only",
          metadata: { host: "only.example.com" },
          start: "2025-10-18T12:00:00Z",
          curUpload: 5,
          curDownload: 7,
        },
      ],
    };

    render(<ConnectionsPage />);

    expect(screen.getByTestId("connection-table")).toBeInTheDocument();
    expect(screen.queryByTestId("virtuoso")).not.toBeInTheDocument();
    expect(screen.queryByTestId("base-styled-select")).not.toBeInTheDocument();
  });

  it("toggles layout when clicking the layout button", async () => {
    mockConnections = {
      uploadTotal: 0,
      downloadTotal: 0,
      connections: [],
    };

    const user = userEvent.setup();
    render(<ConnectionsPage />);

    const layoutButton = screen
      .getByTestId("TableChartRoundedIcon")
      .closest("button")!;

    await user.click(layoutButton);

    expect(setSettingMock).toHaveBeenCalled();
    const applied = setSettingMock.mock.calls[0][0];
    const next =
      typeof applied === "function" ? applied({ layout: "list" }) : applied;
    expect(next.layout).toBe("table");
  });

  it("pauses and resumes the data refresh cycle", async () => {
    mockConnections = {
      uploadTotal: 0,
      downloadTotal: 0,
      connections: [],
    };

    const user = userEvent.setup();
    render(<ConnectionsPage />);

    const pauseButton = screen.getByTitle("Pause");
    await user.click(pauseButton);

    expect(screen.getByTitle("Resume")).toBeInTheDocument();
  });

  it("invokes closeAllConnections when clicking the Close All button", async () => {
    mockConnections = {
      uploadTotal: 0,
      downloadTotal: 0,
      connections: [],
    };
    const user = userEvent.setup();
    render(<ConnectionsPage />);

    const header = screen.getByTestId("base-page-header");
    const closeAllButton = within(header).getByRole("button", {
      name: "Close All",
    });
    await user.click(closeAllButton);

    expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
  });
});
