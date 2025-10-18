import { act, renderHook, waitFor } from "@testing-library/react";
import type { MockedFunction } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const setupTrafficMock = async (
  sequence: Array<{ response: { data: { up: number; down: number } } }>,
) => {
  const trafficModule = await import("@/hooks/use-traffic-data");
  const useTrafficDataMock = vi.spyOn(
    trafficModule,
    "useTrafficData",
  ) as MockedFunction<typeof trafficModule.useTrafficData>;

  let callCount = 0;
  useTrafficDataMock.mockImplementation(() => {
    const index = Math.min(callCount, sequence.length - 1);
    callCount += 1;
    return sequence[index] as any;
  });

  const monitorModule = await import("@/hooks/use-traffic-monitor");

  return {
    useTrafficDataMock,
    ...monitorModule,
  };
};

describe("useTrafficGraphDataEnhanced", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("accumulates traffic data points and exposes them via data getters", async () => {
    const timestamps: number[] = [
      1_700_000_000_000, 1_700_000_001_000, 1_700_000_002_000,
      1_700_000_003_000, 1_700_000_004_000,
    ];
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(
      () => timestamps[Math.min(tick++, timestamps.length - 1)],
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { useTrafficGraphDataEnhanced } = await setupTrafficMock([
      { response: { data: { up: 10, down: 5 } } },
      { response: { data: { up: 7, down: 3 } } },
    ]);

    const { result, rerender } = renderHook(() =>
      useTrafficGraphDataEnhanced(),
    );

    await waitFor(() =>
      expect(result.current.getDataForTimeRange(60)).toHaveLength(1),
    );
    expect(result.current.getDataForTimeRange(60)[0]).toMatchObject({
      up: 10,
      down: 5,
    });

    await act(async () => {
      rerender();
    });

    await waitFor(() =>
      expect(result.current.getDataForTimeRange(60)).toHaveLength(2),
    );
    const points = result.current.getDataForTimeRange(60);
    expect(points[1]).toMatchObject({ up: 7, down: 3 });
    expect(points[0].timestamp).toBeLessThan(points[1].timestamp);
  });

  it("clears accumulated data when clearData is invoked", async () => {
    const timestamps: number[] = [
      1_700_100_000_000, 1_700_100_001_000, 1_700_100_002_000,
      1_700_100_003_000, 1_700_100_004_000,
    ];
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(
      () => timestamps[Math.min(tick++, timestamps.length - 1)],
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { useTrafficGraphDataEnhanced } = await setupTrafficMock([
      { response: { data: { up: 4, down: 2 } } },
      { response: { data: { up: 6, down: 1 } } },
    ]);

    const { result, rerender } = renderHook(() =>
      useTrafficGraphDataEnhanced(),
    );

    await waitFor(() =>
      expect(result.current.getDataForTimeRange(60)).toHaveLength(1),
    );

    await act(async () => {
      rerender();
    });

    await waitFor(() =>
      expect(result.current.getDataForTimeRange(60)).toHaveLength(2),
    );

    await act(async () => {
      result.current.clearData();
    });

    await waitFor(() =>
      expect(result.current.getDataForTimeRange(60)).toHaveLength(0),
    );
  });
});
