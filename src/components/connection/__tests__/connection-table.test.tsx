import { render } from "@testing-library/react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useLocalStorage } from "foxact/use-local-storage";
import * as React from "react";
import type { MockedFunction } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionTable } from "@/components/connection/connection-table";

dayjs.extend(relativeTime);

const dataGridMock = vi.fn();
const apiRef = { current: { publishEvent: vi.fn() } };

vi.mock("@mui/x-data-grid", () => {
  return {
    DataGrid: (props: any) => {
      dataGridMock(props);
      return React.createElement("div", { "data-testid": "mock-data-grid" });
    },
    useGridApiRef: () => apiRef,
  };
});

vi.mock("foxact/use-local-storage", () => ({
  useLocalStorage: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const useLocalStorageMock = useLocalStorage as MockedFunction<
  typeof useLocalStorage
>;

const sampleConnection = {
  id: "abc",
  chains: ["A", "B", "C"],
  rule: "DOMAIN-SUFFIX",
  rulePayload: "example.com",
  download: 1024,
  upload: 2048,
  curDownload: 256,
  curUpload: 128,
  start: 1_700_000_000_000,
  metadata: {
    process: "chrome.exe",
    processPath: "C:/Program Files/Chrome/chrome.exe",
    sourceIP: "10.0.0.1",
    sourcePort: 1234,
    destinationIP: "93.184.216.34",
    destinationPort: 80,
    remoteDestination: "93.184.216.34",
    host: "example.com",
    network: "tcp",
    type: "http",
  },
} as any;

describe("ConnectionTable", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps connections into grid rows and columns", () => {
    let latestWidths: Record<string, number> = {};
    const setWidths = vi.fn((updater) => {
      latestWidths =
        typeof updater === "function" ? updater(latestWidths) : updater;
    });
    useLocalStorageMock.mockReturnValue([{}, setWidths]);

    render(
      <ConnectionTable
        connections={[sampleConnection]}
        onShowDetail={vi.fn()}
      />,
    );

    expect(dataGridMock).toHaveBeenCalledTimes(1);
    const props = dataGridMock.mock.calls[0][0];

    expect(props.rows).toHaveLength(1);
    const row = props.rows[0];

    expect(row.host).toBe("example.com:80");
    expect(row.chains).toBe("C / B / A");
    expect(row.rule).toBe("DOMAIN-SUFFIX(example.com)");
    expect(row.process).toBe("chrome.exe");
    expect(row.source).toBe("10.0.0.1:1234");
    expect(row.remoteDestination).toBe("93.184.216.34:80");
    expect(row.type).toBe("http(tcp)");

    const downloadCol = props.columns.find(
      (col: any) => col.field === "download",
    );
    expect(downloadCol?.headerName).toBe("Downloaded");
    expect(downloadCol?.valueFormatter(sampleConnection.download)).toBe(
      "1.00 KB",
    );

    const dlSpeedCol = props.columns.find(
      (col: any) => col.field === "dlSpeed",
    );
    expect(dlSpeedCol?.valueFormatter(sampleConnection.curDownload)).toBe(
      "256 B/s",
    );

    const timeCol = props.columns.find((col: any) => col.field === "time");
    expect(timeCol?.valueFormatter(sampleConnection.start)).toBe(
      dayjs(sampleConnection.start).fromNow(),
    );
  });

  it("invokes onShowDetail when a row is clicked", () => {
    const setWidths = vi.fn();
    useLocalStorageMock.mockReturnValue([{}, setWidths]);
    const onShowDetail = vi.fn();

    render(
      <ConnectionTable
        connections={[sampleConnection]}
        onShowDetail={onShowDetail}
      />,
    );

    const props = dataGridMock.mock.calls[0][0];
    props.onRowClick({ row: { connectionData: sampleConnection } });
    expect(onShowDetail).toHaveBeenCalledWith(sampleConnection);
  });

  it("stores column width changes via local storage hook", () => {
    let latestWidths: Record<string, number> = {};
    const setWidths = vi.fn((updater) => {
      latestWidths =
        typeof updater === "function" ? updater(latestWidths) : updater;
    });
    useLocalStorageMock.mockReturnValue([{}, setWidths]);

    render(
      <ConnectionTable
        connections={[sampleConnection]}
        onShowDetail={vi.fn()}
      />,
    );

    const props = dataGridMock.mock.calls[0][0];
    props.onColumnResize({
      colDef: { field: "host" },
      width: 300,
    });

    expect(latestWidths).toEqual({ host: 300 });
  });
});
