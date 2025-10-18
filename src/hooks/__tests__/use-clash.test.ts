import { renderHook } from "@testing-library/react";
import { useLockFn } from "ahooks";
import useSWR, { mutate as swrMutate } from "swr";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClash, useClashInfo } from "@/hooks/use-clash";
import { patchClashConfig } from "@/services/cmds";

vi.mock("ahooks", () => ({
  useLockFn: vi.fn((fn) => fn),
}));

vi.mock("swr", () => {
  const swrMock = vi.fn();
  const mutateMock = vi.fn();
  return {
    default: swrMock,
    mutate: mutateMock,
  };
});

vi.mock("@/services/cmds", () => ({
  getRuntimeConfig: vi.fn(),
  getClashInfo: vi.fn(),
  patchClashConfig: vi.fn(),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  getVersion: vi.fn(),
}));

const useSWRMock = useSWR as unknown as Mock;
const useLockFnMock = useLockFn as unknown as Mock;

const mutateMock = swrMutate as unknown as Mock;

const mutateRuntimeConfig = vi.fn();
const mutateVersion = vi.fn();
const mutateInfo = vi.fn();

describe("useClash", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useSWRMock.mockReset();
    useLockFnMock.mockReset();
  });

  it("formats version with Mihomo suffix when meta data is present", () => {
    useSWRMock.mockImplementation((key: string) => {
      if (key === "getRuntimeConfig") {
        return { data: { runtime: true }, mutate: mutateRuntimeConfig };
      }

      if (key === "getVersion") {
        return {
          data: { version: "2024.01", meta: { commit: "abc" } },
          mutate: mutateVersion,
        };
      }

      return { data: undefined, mutate: vi.fn() };
    });

    const { result } = renderHook(() => useClash());

    expect(result.current.clash).toEqual({ runtime: true });
    expect(result.current.version).toBe("2024.01 Mihomo");
    expect(result.current.mutateClash).toBe(mutateRuntimeConfig);
    expect(result.current.mutateVersion).toBe(mutateVersion);
  });

  it("patchClash calls patchClashConfig and revalidates runtime config", async () => {
    useSWRMock.mockImplementation((key: string) => {
      if (key === "getRuntimeConfig") {
        return { data: undefined, mutate: mutateRuntimeConfig };
      }

      if (key === "getVersion") {
        return { data: undefined, mutate: mutateVersion };
      }

      return { data: undefined, mutate: vi.fn() };
    });

    const patchClashConfigMock = patchClashConfig as Mock;
    patchClashConfigMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useClash());

    await result.current.patchClash({
      "mixed-port": 1234,
    } as Partial<IConfigData>);

    expect(patchClashConfigMock).toHaveBeenCalledWith({
      "mixed-port": 1234,
    });
    expect(mutateRuntimeConfig).toHaveBeenCalledTimes(1);
  });
});

describe("useClashInfo", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useSWRMock.mockReset();
  });

  it("skips patch when payload does not include tracked keys", async () => {
    useSWRMock.mockImplementation((key: string) => {
      if (key === "getClashInfo") {
        return { data: { info: true }, mutate: mutateInfo };
      }
      return { data: undefined, mutate: vi.fn() };
    });

    const patchClashConfigMock = patchClashConfig as Mock;

    const { result } = renderHook(() => useClashInfo());

    await result.current.patchInfo({} as any);

    expect(patchClashConfigMock).not.toHaveBeenCalled();
    expect(mutateInfo).not.toHaveBeenCalled();
  });

  it("validates port ranges before patching", async () => {
    useSWRMock.mockImplementation((key: string) => {
      if (key === "getClashInfo") {
        return { data: {}, mutate: mutateInfo };
      }
      return { data: undefined, mutate: vi.fn() };
    });

    const patchClashConfigMock = patchClashConfig as Mock;

    const { result } = renderHook(() => useClashInfo());

    await expect(
      result.current.patchInfo({ "redir-port": 1000 }),
    ).rejects.toThrow("The port should not < 1111");
    expect(patchClashConfigMock).not.toHaveBeenCalled();

    await expect(
      result.current.patchInfo({ "redir-port": 70000 }),
    ).rejects.toThrow("The port should not > 65536");
    expect(patchClashConfigMock).not.toHaveBeenCalled();
  });

  it("patches config and triggers revalidation for valid payloads", async () => {
    useSWRMock.mockImplementation((key: string) => {
      if (key === "getClashInfo") {
        return { data: {}, mutate: mutateInfo };
      }
      return { data: undefined, mutate: vi.fn() };
    });

    const patchClashConfigMock = patchClashConfig as Mock;
    patchClashConfigMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useClashInfo());

    await result.current.patchInfo({
      "redir-port": 1234,
      secret: "token",
    });

    expect(patchClashConfigMock).toHaveBeenCalledWith({
      "redir-port": 1234,
      secret: "token",
    });
    expect(mutateInfo).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith("getClashConfig");
  });
});
