import { act, renderHook } from "@testing-library/react";
import type { Traffic } from "tauri-plugin-mihomo-api";
import { afterEach, describe, expect, it, vi } from "vitest";

const appendTraffic = (
  appendData: (traffic: Traffic) => void,
  data: Traffic,
) => {
  act(() => {
    appendData(data);
  });
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

    const { useTrafficGraphDataEnhanced } = await import(
      "@/hooks/use-traffic-monitor"
    );

    const { result } = renderHook(() => useTrafficGraphDataEnhanced());

    appendTraffic(result.current.appendData, { up: 10, down: 5 } as Traffic);

    expect(result.current.getDataForTimeRange(60)).toHaveLength(1);
    expect(result.current.getDataForTimeRange(60)[0]).toMatchObject({
      up: 10,
      down: 5,
    });

    appendTraffic(result.current.appendData, { up: 7, down: 3 } as Traffic);

    expect(result.current.getDataForTimeRange(60)).toHaveLength(2);
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

    const { useTrafficGraphDataEnhanced } = await import(
      "@/hooks/use-traffic-monitor"
    );

    const { result } = renderHook(() => useTrafficGraphDataEnhanced());

    appendTraffic(result.current.appendData, { up: 4, down: 2 } as Traffic);

    expect(result.current.getDataForTimeRange(60)).toHaveLength(1);

    appendTraffic(result.current.appendData, { up: 6, down: 1 } as Traffic);

    expect(result.current.getDataForTimeRange(60)).toHaveLength(2);

    act(() => {
      result.current.clearData();
    });

    expect(result.current.getDataForTimeRange(60)).toHaveLength(0);
  });
});
