import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type * as DiagnosticsModule from "@/utils/traffic-diagnostics";

describe("traffic-diagnostics utilities", () => {
  let diagnostics: typeof DiagnosticsModule;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalMemory: any;
  let originalWindow: typeof globalThis.window | undefined;

  const baseStats = {
    rawBufferSize: 64,
    compressedBufferSize: 32,
    compressionQueueSize: 4,
    totalMemoryPoints: 120,
  };

  beforeEach(async () => {
    vi.resetModules();
    originalWindow = (globalThis as any).window;
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    diagnostics = await import("@/utils/traffic-diagnostics");
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    originalMemory = (performance as any).memory;
    (performance as any).memory = { usedJSHeapSize: 0 };
    diagnostics.resetErrorCount();
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (originalMemory === undefined) {
      delete (performance as any).memory;
    } else {
      (performance as any).memory = originalMemory;
    }
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
    vi.unstubAllGlobals();
  });

  it("exposes helpers on window for manual debugging", () => {
    const registry = (window as any).trafficDiagnostics;
    expect(registry).toBeDefined();
    expect(registry.generateDiagnosticReport).toBe(
      diagnostics.generateDiagnosticReport,
    );
    expect(registry.resetErrorCount).toBe(diagnostics.resetErrorCount);
  });

  it("builds a comprehensive diagnostics report", () => {
    (performance as any).memory = { usedJSHeapSize: 256 * 1024 * 1024 };
    const stats = {
      rawBufferSize: 200,
      compressedBufferSize: 180,
      compressionQueueSize: 12,
      totalMemoryPoints: 2000,
    };

    const report = diagnostics.generateDiagnosticReport(0, stats, false);

    expect(report.referenceCount).toBe(0);
    expect(report.samplerStats).toEqual(stats);
    expect(report.performance.memoryUsage).toBeGreaterThanOrEqual(256);
    expect(report.performance.lastDataFreshness).toBe(false);
    expect(report.recommendations).toHaveLength(5);
  });

  it("tracks errors reported by consumers", () => {
    diagnostics.recordTrafficError(new Error("boom"), "TrafficGraph");
    diagnostics.recordTrafficError(new Error("zap"), "TrafficGraph");

    const report = diagnostics.generateDiagnosticReport(1, baseStats, true);

    expect(report.performance.errorCount).toBe(2);
    expect(report.recommendations.some((rec) => rec.includes("错误"))).toBe(
      true,
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });

  it("resets global error state when requested", () => {
    diagnostics.recordTrafficError(new Error("boom"), "TrafficGraph");
    diagnostics.resetErrorCount();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("错误计数器"),
    );

    const report = diagnostics.generateDiagnosticReport(1, baseStats, true);
    expect(report.performance.errorCount).toBe(0);
  });

  it("prints formatted output during ad-hoc diagnostics", () => {
    diagnostics.runTrafficDiagnostics(1, baseStats, true);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("流量统计系统诊断报告"),
    );
  });
});
