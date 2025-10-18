import { renderHook, waitFor } from "@testing-library/react";
import { useLocalStorage } from "foxact/use-local-storage";
import { mutate } from "swr";
import useSWRSubscription from "swr/subscription";
import type { SWRSubscriptionResponse } from "swr/subscription";
import type { MockedFunction } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTrafficData } from "@/hooks/use-traffic-data";

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
    connect_traffic: vi.fn(),
    connect_connections: vi.fn(),
  },
}));

const useLocalStorageMock = useLocalStorage as MockedFunction<
  typeof useLocalStorage
>;
const mutateMock = mutate as MockedFunction<typeof mutate>;
const useSWRSubscriptionMock = useSWRSubscription as MockedFunction<
  typeof useSWRSubscription
>;

describe("useTrafficData", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("subscribes using the date-backed key and keeps the provided response", () => {
    const initialDate = 1700000000;
    const setDate = vi.fn();
    const subscriptionResponse: SWRSubscriptionResponse<
      { up: number; down: number },
      unknown
    > = { data: { up: 10, down: 20 } };

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockReturnValue(subscriptionResponse);

    const { result } = renderHook(() => useTrafficData());

    expect(useSWRSubscriptionMock).toHaveBeenCalledWith(
      `getClashTraffic-${initialDate}`,
      expect.any(Function),
      expect.objectContaining({
        fallbackData: { up: 0, down: 0 },
        keepPreviousData: true,
      }),
    );
    expect(result.current.response).toBe(subscriptionResponse);
  });

  it("triggers mutate and refreshes the date on demand", async () => {
    const initialDate = 987654321;
    const setDate = vi.fn();

    useLocalStorageMock.mockReturnValue([initialDate, setDate]);
    useSWRSubscriptionMock.mockReturnValue({
      data: { up: 0, down: 0 },
    } as SWRSubscriptionResponse<{ up: number; down: number }, unknown>);

    const { result } = renderHook(() => useTrafficData());

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        `$sub$getClashTraffic-${initialDate}`,
      );
    });

    const now = 1_725_897_600_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    result.current.refreshGetClashTraffic();
    nowSpy.mockRestore();

    expect(setDate).toHaveBeenCalledTimes(1);
    expect(setDate).toHaveBeenCalledWith(now);
  });
});
