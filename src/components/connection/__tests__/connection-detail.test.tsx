import { ThemeProvider, createTheme } from "@mui/material/styles";
import { act, fireEvent, render, screen } from "@testing-library/react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import React, { type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConnectionDetail,
  type ConnectionDetailRef,
} from "@/components/connection/connection-detail";
import parseTraffic from "@/utils/parse-traffic";

dayjs.extend(relativeTime);

const closeConnectionsMock = vi.fn();
const snackbarPropsSpy = vi.fn();

vi.mock("@mui/material", async () => {
  const actual =
    await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    Snackbar: ({ message, open, ...rest }: any) => {
      snackbarPropsSpy({ message, open, ...rest });
      return (
        <div data-testid="mock-snackbar" data-open={open}>
          {message}
        </div>
      );
    },
  };
});

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeConnections: (...args: Parameters<typeof closeConnectionsMock>) =>
    closeConnectionsMock(...args),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("i18next", () => ({
  t: (key: string) => key,
}));

const createDetailRef = (): MutableRefObject<ConnectionDetailRef | null> => ({
  current: null,
});

const renderDetail = (
  ref: MutableRefObject<ConnectionDetailRef | null> = createDetailRef(),
) => {
  render(
    <ThemeProvider theme={createTheme()}>
      <ConnectionDetail {...({ ref } as any)} />
    </ThemeProvider>,
  );
  return ref;
};

describe("ConnectionDetail", () => {
  const baseDetail = {
    id: "connection-1",
    chains: ["ProxyA", "ProxyB", "ProxyC"],
    rule: "DOMAIN-SUFFIX",
    rulePayload: "example.com",
    download: 4096,
    upload: 2048,
    curDownload: 512,
    curUpload: 256,
    start: Date.UTC(2023, 11, 31, 23, 59, 0),
    metadata: {
      host: "example.com",
      destinationPort: 443,
      remoteDestination: "93.184.216.34",
      destinationIP: "93.184.216.34",
      sourceIP: "10.0.0.5",
      sourcePort: 51234,
      process: "chrome.exe",
      processPath: "C:/Program Files/Chrome/chrome.exe",
      type: "https",
      network: "tcp",
    },
  } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 0, 1, 0, 5, 0)));
    closeConnectionsMock.mockReset();
    snackbarPropsSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes an open method that renders connection details", () => {
    const detailRef = renderDetail();

    expect(detailRef.current).toBeDefined();

    act(() => {
      detailRef.current?.open(baseDetail);
    });

    const reversedChains = baseDetail.chains.slice().reverse().join(" / ");
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText(": example.com:443")).toBeInTheDocument();
    expect(screen.getByText("Chains")).toBeInTheDocument();
    expect(screen.getByText(`: ${reversedChains}`)).toBeInTheDocument();
    expect(screen.getByText("Rule")).toBeInTheDocument();
    expect(
      screen.getByText(`: ${baseDetail.rule}(${baseDetail.rulePayload})`),
    ).toBeInTheDocument();

    const expectedDownload = parseTraffic(baseDetail.download).join(" ");
    const expectedUpload = parseTraffic(baseDetail.upload).join(" ");
    const expectedCurDownload = parseTraffic(baseDetail.curDownload).join(" ");
    const expectedCurUpload = parseTraffic(baseDetail.curUpload).join(" ");

    expect(screen.getByText(`: ${expectedDownload}`)).toBeInTheDocument();
    expect(screen.getByText(`: ${expectedUpload}`)).toBeInTheDocument();
    expect(screen.getByText(`: ${expectedCurDownload}/s`)).toBeInTheDocument();
    expect(screen.getByText(`: ${expectedCurUpload}/s`)).toBeInTheDocument();

    const expectedProcess = `${baseDetail.metadata.process}(${baseDetail.metadata.processPath})`;
    expect(screen.getByText(`: ${expectedProcess}`)).toBeInTheDocument();

    const expectedTime = dayjs(baseDetail.start).fromNow();
    expect(screen.getByText(`: ${expectedTime}`)).toBeInTheDocument();
  });

  it("formats host and destination using fallback metadata when host is missing", () => {
    const detailRef = renderDetail();

    const alternateDetail = {
      ...baseDetail,
      id: "connection-fallback",
      chains: [],
      rule: "MATCH",
      rulePayload: undefined,
      download: 0,
      upload: 0,
      curDownload: undefined,
      curUpload: undefined,
      metadata: {
        ...baseDetail.metadata,
        host: undefined,
        destinationIP: undefined,
        remoteDestination: "198.51.100.9",
        destinationPort: 8080,
        process: "alt.exe",
        processPath: undefined,
      },
    };

    act(() => {
      detailRef.current?.open(alternateDetail as any);
    });

    expect(screen.getByText(": 198.51.100.9:8080")).toBeInTheDocument();
    expect(screen.getByText(": 198.51.100.9")).toBeInTheDocument();
    expect(screen.getByText(": MATCH")).toBeInTheDocument();
    expect(screen.getByText(": alt.exe")).toBeInTheDocument();
    expect(screen.getAllByText(": 0 B")).toHaveLength(2);
    expect(screen.getAllByText(": -1 B/s")).toHaveLength(2);
  });

  it("closes the snackbar and connection when action button is pressed", async () => {
    closeConnectionsMock.mockResolvedValue(undefined);
    const detailRef = renderDetail();

    act(() => {
      detailRef.current?.open(baseDetail);
    });

    expect(snackbarPropsSpy.mock.calls.at(-1)?.[0].open).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close Connection" }));
    });

    expect(closeConnectionsMock).toHaveBeenCalledWith(baseDetail.id);

    expect(snackbarPropsSpy.mock.calls.at(-1)?.[0].open).toBe(false);

    const reopenedDetail = {
      ...baseDetail,
      id: "connection-reopen",
      metadata: {
        ...baseDetail.metadata,
        host: "reopened.example.com",
      },
    };

    await act(async () => {
      detailRef.current?.open(reopenedDetail);
    });

    const latestMessage = snackbarPropsSpy.mock.calls.at(-1)?.[0]
      .message as any;
    expect(latestMessage?.props?.data?.metadata?.host).toBe(
      "reopened.example.com",
    );

    expect(snackbarPropsSpy.mock.calls.at(-1)?.[0].open).toBe(true);
    expect(latestMessage?.props?.data).toBe(reopenedDetail);
  });

  it("ignores subsequent open calls while already visible", () => {
    const detailRef = renderDetail();

    const firstDetail = baseDetail;
    const secondDetail = {
      ...baseDetail,
      id: "connection-2",
      metadata: {
        ...baseDetail.metadata,
        host: "second.example.com",
      },
    };

    act(() => {
      detailRef.current?.open(firstDetail);
    });
    act(() => {
      detailRef.current?.open(secondDetail);
    });

    expect(screen.getByText(": example.com:443")).toBeInTheDocument();
    expect(screen.queryByText(": second.example.com:443")).toBeNull();
  });
});
