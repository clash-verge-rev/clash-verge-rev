import { renderHook } from "@testing-library/react";
import useSWR from "swr";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSystemState } from "@/hooks/use-system-state";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWRMock = useSWR as unknown as Mock;

describe("useSystemState", () => {
  afterEach(() => {
    useSWRMock.mockReset();
  });

  it("provides sidecar defaults when service checks are skipped", () => {
    const mutateRunningMode = vi.fn();
    const mutateServiceOk = vi.fn();
    const mutateTunMode = vi.fn();

    useSWRMock.mockImplementation((key: unknown) => {
      if (key === "getRunningMode") {
        return { data: undefined, mutate: mutateRunningMode, isLoading: false };
      }

      if (key === "isAdmin") {
        return { data: false, mutate: vi.fn(), isLoading: false };
      }

      if (key === null) {
        return { data: false, mutate: mutateServiceOk, isLoading: false };
      }

      if (Array.isArray(key) && key[0] === "isTunModeAvailable") {
        return {
          data: Boolean(key[1]) || Boolean(key[2]),
          mutate: mutateTunMode,
          isLoading: false,
        };
      }

      return { data: undefined, mutate: vi.fn(), isLoading: false };
    });

    const { result } = renderHook(() => useSystemState());

    expect(result.current.runningMode).toBe("Sidecar");
    expect(result.current.isSidecarMode).toBe(true);
    expect(result.current.isServiceMode).toBe(false);
    expect(result.current.isServiceOk).toBe(false);
    expect(result.current.isTunModeAvailable).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.mutateRunningMode).toBe(mutateRunningMode);
    expect(result.current.mutateServiceOk).toBe(mutateServiceOk);
    expect(result.current.mutateTunModeAvailable).toBe(mutateTunMode);
  });

  it("exposes service state information when running in service mode", () => {
    const mutateRunningMode = vi.fn();
    const mutateServiceOk = vi.fn();
    const mutateTunMode = vi.fn();

    useSWRMock.mockImplementation((key: unknown) => {
      if (key === "getRunningMode") {
        return { data: "Service", mutate: mutateRunningMode, isLoading: false };
      }

      if (key === "isAdmin") {
        return { data: false, mutate: vi.fn(), isLoading: false };
      }

      if (key === "isServiceAvailable") {
        return { data: true, mutate: mutateServiceOk, isLoading: true };
      }

      if (Array.isArray(key) && key[0] === "isTunModeAvailable") {
        return {
          data: Boolean(key[1]) || Boolean(key[2]),
          mutate: mutateTunMode,
          isLoading: false,
        };
      }

      return { data: undefined, mutate: vi.fn(), isLoading: false };
    });

    const { result } = renderHook(() => useSystemState());

    expect(result.current.runningMode).toBe("Service");
    expect(result.current.isSidecarMode).toBe(false);
    expect(result.current.isServiceMode).toBe(true);
    expect(result.current.isServiceOk).toBe(true);
    expect(result.current.isTunModeAvailable).toBe(true);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.mutateRunningMode).toBe(mutateRunningMode);
    expect(result.current.mutateServiceOk).toBe(mutateServiceOk);
    expect(result.current.mutateTunModeAvailable).toBe(mutateTunMode);
  });
});
