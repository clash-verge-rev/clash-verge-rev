import { renderHook, waitFor } from "@testing-library/react";
import { useLocalStorage } from "foxact/use-local-storage";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import type { SWRSubscriptionResponse } from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";

import { initConnData, useConnectionData } from "@/hooks/use-connection-data";

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
    connect_connections: vi.fn(),
    connect_traffic: vi.fn(),
  },
}));

const useLocalStorageMock = useLocalStorage as MockedFunction<
  typeof useLocalStorage
>;
const mutateMock = mutate as MockedFunction<typeof mutate>;
const useSWRSubscriptionMock = useSWRSubscription as MockedFunction<
  typeof useSWRSubscription
>;
const connectConnectionsMock =
  MihomoWebSocket.connect_connections as MockedFunction<
    typeof MihomoWebSocket.connect_connections
  >;

describe("useConnectionData", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("subscribes with the date-based key and returns the subscription value", () => {
    const initialDate = 123456;
    const setDate = vi.fn();
    const subscriptionResponse: SWRSubscriptionResponse<IConnections, unknown> =
      {
        data: { ...initConnData, marker: true } as unknown as IConnections,
      };

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockReturnValue(subscriptionResponse);

    const { result } = renderHook(() => useConnectionData());

    expect(useSWRSubscriptionMock).toHaveBeenCalledWith(
      `getClashConnection-${initialDate}`,
      expect.any(Function),
      expect.objectContaining({
        fallbackData: initConnData,
        keepPreviousData: true,
      }),
    );
    expect(result.current.response).toBe(subscriptionResponse);
  });

  it("invokes mutate on render and refreshes the date when requested", async () => {
    const initialDate = 67890;
    const setDate = vi.fn();

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockReturnValue({
      data: initConnData,
    } as SWRSubscriptionResponse<IConnections, unknown>);

    const { result } = renderHook(() => useConnectionData());

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        `$sub$getClashConnection-${initialDate}`,
      );
    });

    const now = 1_725_897_700_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    result.current.refreshGetClashConnection();
    nowSpy.mockRestore();

    expect(setDate).toHaveBeenCalledWith(now);
  });

  it("derives incremental upload and download rates from websocket updates", async () => {
    const initialDate = 111;
    const setDate = vi.fn();
    let subscriptionHandler: any;

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockImplementation((key, handler) => {
      subscriptionHandler = handler;
      return {
        data: initConnData,
      } as SWRSubscriptionResponse<IConnections, unknown>;
    });

    const closeMock = vi.fn();
    const listenerCallbacks: Array<(message: any) => void> = [];
    connectConnectionsMock.mockResolvedValue({
      addListener: (cb: (message: any) => void) => {
        listenerCallbacks.push(cb);
      },
      close: closeMock,
    } as any);

    renderHook(() => useConnectionData());

    expect(subscriptionHandler).toBeInstanceOf(Function);

    let derived: any;
    const next = vi.fn((error: any, updater: any) => {
      expect(error).toBeNull();
      const previous = {
        ...initConnData,
        connections: [
          {
            id: "conn-1",
            upload: 100,
            download: 200,
            curUpload: 0,
            curDownload: 0,
          },
        ],
      } as any;
      derived =
        typeof updater === "function" ? updater(previous) : updater || null;
    });

    const cleanup = subscriptionHandler(`getClashConnection-${initialDate}`, {
      next,
    });

    await Promise.resolve();

    expect(connectConnectionsMock).toHaveBeenCalledTimes(1);
    expect(listenerCallbacks).toHaveLength(1);

    const message = {
      type: "Text",
      data: JSON.stringify({
        uploadTotal: 150,
        downloadTotal: 260,
        connections: [
          {
            id: "conn-1",
            upload: 150,
            download: 260,
          },
        ],
      }),
    };

    listenerCallbacks[0](message);

    expect(next).toHaveBeenCalledTimes(1);
    expect(derived.connections[0].curUpload).toBe(50);
    expect(derived.connections[0].curDownload).toBe(60);

    cleanup();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
