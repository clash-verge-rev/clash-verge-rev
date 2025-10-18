import { renderHook, waitFor } from "@testing-library/react";
import dayjs from "dayjs";
import { useLocalStorage } from "foxact/use-local-storage";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import type { SWRSubscriptionResponse } from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";

import { useLogData } from "@/hooks/use-log-data-new";
import { getClashLogs } from "@/services/cmds";
import { useClashLog } from "@/services/states";

vi.mock("dayjs", () => ({
  default: vi.fn(() => ({
    format: vi.fn().mockReturnValue("2024-10-18 18:30:00"),
  })),
}));

vi.mock("foxact/use-local-storage", () => ({
  useLocalStorage: vi.fn(),
}));

vi.mock("swr", () => ({
  mutate: vi.fn(),
}));

vi.mock("swr/subscription", () => ({
  default: vi.fn(),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  MihomoWebSocket: {
    connect_logs: vi.fn(),
    connect_connections: vi.fn(),
    connect_traffic: vi.fn(),
  },
}));

vi.mock("@/services/cmds", () => ({
  getClashLogs: vi.fn(),
}));

vi.mock("@/services/states", () => ({
  useClashLog: vi.fn(),
}));

const dayjsMock = dayjs as unknown as MockedFunction<typeof dayjs>;
const useLocalStorageMock = useLocalStorage as MockedFunction<
  typeof useLocalStorage
>;
const mutateMock = mutate as MockedFunction<typeof mutate>;
const useSWRSubscriptionMock = useSWRSubscription as MockedFunction<
  typeof useSWRSubscription
>;
const connectLogsMock = MihomoWebSocket.connect_logs as MockedFunction<
  typeof MihomoWebSocket.connect_logs
>;
const getClashLogsMock = getClashLogs as MockedFunction<typeof getClashLogs>;
const useClashLogMock = useClashLog as MockedFunction<typeof useClashLog>;

describe("useLogData", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("filters initial logs and flushes buffered messages for the configured level", async () => {
    vi.useFakeTimers();

    dayjsMock.mockReturnValue({
      format: vi.fn().mockReturnValue("10-18 18:30:00"),
    } as any);

    const initialDate = 1_700_000_000;
    const setDate = vi.fn();

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useClashLogMock.mockReturnValue([
      { enable: true, logLevel: "warning", logFilter: "all" },
      vi.fn(),
    ]);

    const initialLogs = [
      { id: 1, type: "info" },
      { id: 2, type: "warning" },
      { id: 3, type: "error" },
    ];
    getClashLogsMock.mockResolvedValue(initialLogs as any);

    let subscriptionHandler: any;
    useSWRSubscriptionMock.mockImplementation((_key, handler) => {
      subscriptionHandler = handler;
      return {
        data: [],
      } as SWRSubscriptionResponse<any, unknown>;
    });

    const closeMock = vi.fn();
    const listenerCallbacks: Array<(message: any) => void> = [];
    connectLogsMock.mockResolvedValue({
      addListener: (cb: (message: any) => void) => {
        listenerCallbacks.push(cb);
      },
      close: closeMock,
    } as any);

    const { result } = renderHook(() => useLogData());

    expect(subscriptionHandler).toBeInstanceOf(Function);

    const next = vi.fn();
    const cleanup = subscriptionHandler(`getClashLog-${initialDate}`, { next });

    // Allow async connect and initial fetch to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(connectLogsMock).toHaveBeenCalledWith("warning");
    expect(getClashLogsMock).toHaveBeenCalledTimes(1);

    expect(next).toHaveBeenCalledWith(null, [
      { id: 2, type: "warning" },
      { id: 3, type: "error" },
    ]);

    expect(listenerCallbacks).toHaveLength(1);

    const incomingLog = { id: 4, type: "warning", data: "payload" };
    listenerCallbacks[0]({
      type: "Text",
      data: JSON.stringify(incomingLog),
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(next).toHaveBeenCalledTimes(2);

    const [errorArg, updater] = next.mock.calls[1];
    expect(errorArg).toBeNull();
    expect(typeof updater).toBe("function");

    const existing = [
      { id: 2, type: "warning" },
      { id: 3, type: "error" },
    ];
    const flushed = updater(existing as any);
    expect(flushed).toHaveLength(3);
    expect(flushed[2]).toMatchObject({
      id: 4,
      type: "warning",
      data: "payload",
      time: "10-18 18:30:00",
    });

    cleanup();
    expect(closeMock).toHaveBeenCalledTimes(1);

    expect(result.current.response).toEqual({
      data: [],
    });
  });

  it("refreshes or clears cached logs on demand", async () => {
    const initialDate = 2_000_000_000;
    const setDate = vi.fn();

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useClashLogMock.mockReturnValue([
      { enable: true, logLevel: "info", logFilter: "all" },
      vi.fn(),
    ]);
    getClashLogsMock.mockResolvedValue([]);

    useSWRSubscriptionMock.mockReturnValue({
      data: [],
    } as SWRSubscriptionResponse<any, unknown>);

    const { result } = renderHook(() => useLogData());

    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith(
        `$sub$getClashLog-${initialDate}`,
      ),
    );

    mutateMock.mockClear();

    result.current.refreshGetClashLog(true);
    expect(mutateMock).toHaveBeenCalledWith(
      `$sub$getClashLog-${initialDate}`,
      [],
    );

    mutateMock.mockClear();

    const now = 1_725_900_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    result.current.refreshGetClashLog();
    nowSpy.mockRestore();

    expect(setDate).toHaveBeenCalledWith(now);
  });
});
