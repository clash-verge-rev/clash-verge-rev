import { renderHook, waitFor } from "@testing-library/react";
import { useLocalStorage } from "foxact/use-local-storage";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import type { SWRSubscriptionResponse } from "swr/subscription";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";

import { useMemoryData } from "@/hooks/use-memory-data";

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
    connect_memory: vi.fn(),
  },
}));

const useLocalStorageMock = useLocalStorage as MockedFunction<
  typeof useLocalStorage
>;
const mutateMock = mutate as MockedFunction<typeof mutate>;
const useSWRSubscriptionMock = useSWRSubscription as MockedFunction<
  typeof useSWRSubscription
>;
const connectMemoryMock = MihomoWebSocket.connect_memory as MockedFunction<
  typeof MihomoWebSocket.connect_memory
>;

describe("useMemoryData", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes with date-scoped key and returns subscription result", () => {
    const initialDate = 123;
    const setDate = vi.fn();
    const subscriptionResponse: SWRSubscriptionResponse<
      { inuse: number },
      unknown
    > = { data: { inuse: 42 } };

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockReturnValue(subscriptionResponse);

    const { result } = renderHook(() => useMemoryData());

    expect(useSWRSubscriptionMock).toHaveBeenCalledWith(
      `getClashMemory-${initialDate}`,
      expect.any(Function),
      expect.objectContaining({
        fallbackData: { inuse: 0 },
        keepPreviousData: true,
      }),
    );
    expect(result.current.response).toBe(subscriptionResponse);
  });

  it("refreshes mutate key and updates date when requested", async () => {
    const initialDate = 456;
    const setDate = vi.fn();

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockReturnValue({
      data: { inuse: 0 },
    } as SWRSubscriptionResponse<{ inuse: number }, unknown>);

    const { result } = renderHook(() => useMemoryData());

    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith(
        `$sub$getClashMemory-${initialDate}`,
      ),
    );

    const now = 1_725_999_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    result.current.refreshGetClashMemory();
    nowSpy.mockRestore();

    expect(setDate).toHaveBeenCalledWith(now);
  });

  it("handles websocket updates and reconnect flow", async () => {
    const initialDate = 789;
    const setDate = vi.fn();
    let subscriptionHandler: any;

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockImplementation((key, handler) => {
      subscriptionHandler = handler;
      return {
        data: { inuse: 0 },
      } as SWRSubscriptionResponse<{ inuse: number }, unknown>;
    });

    const closeMock = vi.fn();
    const listeners: Array<(message: any) => void> = [];
    connectMemoryMock.mockResolvedValue({
      addListener: (cb: (message: any) => void) => listeners.push(cb),
      close: closeMock,
    } as any);

    renderHook(() => useMemoryData());

    expect(subscriptionHandler).toBeInstanceOf(Function);

    const next = vi.fn();
    const cleanup = subscriptionHandler(`getClashMemory-${initialDate}`, {
      next,
    });

    await Promise.resolve();
    expect(connectMemoryMock).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(1);

    listeners[0]({
      type: "Text",
      data: JSON.stringify({ inuse: 2048 }),
    });

    expect(next).toHaveBeenCalledWith(null, { inuse: 2048 });

    listeners[0]({
      type: "Text",
      data: "Websocket error: boom",
    });

    await Promise.resolve();
    expect(next).toHaveBeenCalledWith("Websocket error: boom", { inuse: 0 });

    cleanup();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
