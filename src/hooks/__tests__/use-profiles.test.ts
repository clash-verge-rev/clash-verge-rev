import { renderHook } from "@testing-library/react";
import useSWR, { mutate as swrMutate } from "swr";
import { selectNodeForGroup } from "tauri-plugin-mihomo-api";
import type { Mock } from "vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useProfiles } from "@/hooks/use-profiles";
import {
  calcuProxies,
  getProfiles,
  patchProfile,
  patchProfilesConfig,
} from "@/services/cmds";

vi.mock("swr", () => {
  const swrMock = vi.fn();
  const mutateMock = vi.fn();
  return {
    default: swrMock,
    mutate: mutateMock,
  };
});

vi.mock("tauri-plugin-mihomo-api", () => ({
  selectNodeForGroup: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({
  getProfiles: vi.fn(),
  patchProfile: vi.fn(),
  patchProfilesConfig: vi.fn(),
  calcuProxies: vi.fn(),
}));

const useSWRMock = useSWR as unknown as Mock;
const mutateMock = swrMutate as unknown as Mock;
const selectNodeForGroupMock = selectNodeForGroup as unknown as Mock;
const patchProfileMock = patchProfile as unknown as Mock;
const patchProfilesConfigMock = patchProfilesConfig as unknown as Mock;
const calcuProxiesMock = calcuProxies as unknown as Mock;
const getProfilesMock = getProfiles as unknown as Mock;

const mutateProfilesMock = vi.fn();

describe("useProfiles", () => {
  beforeAll(() => {
    if (typeof DOMException === "undefined") {
      // @ts-expect-error – add minimal DOMException for node environment
      global.DOMException = class DOMException extends Error {
        constructor(message?: string, name?: string) {
          super(message);
          this.name = name ?? "DOMException";
        }
      };
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    useSWRMock.mockReset();
    mutateProfilesMock.mockReset();
  });

  it("patchProfiles propagates success and revalidates, including abort handling", async () => {
    const profilesData = { items: [], current: null };
    useSWRMock.mockReturnValue({
      data: profilesData,
      mutate: mutateProfilesMock,
      error: null,
      isValidating: false,
    });

    patchProfilesConfigMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useProfiles());

    const success = await result.current.patchProfiles({ current: "test" });

    expect(success).toEqual({ ok: true });
    expect(patchProfilesConfigMock).toHaveBeenCalledWith({ current: "test" });
    expect(mutateProfilesMock).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    await expect(
      result.current.patchProfiles({ current: "ignored" }, controller.signal),
    ).rejects.toThrowError(/aborted/);
    expect(patchProfilesConfigMock).toHaveBeenCalledTimes(1);
  });

  it("patchProfiles retries mutate and surfaces errors", async () => {
    useSWRMock.mockReturnValue({
      data: { items: [], current: null },
      mutate: mutateProfilesMock,
      error: null,
      isValidating: false,
    });

    const failure = new Error("boom");
    patchProfilesConfigMock.mockRejectedValue(failure);

    const { result } = renderHook(() => useProfiles());

    await expect(
      result.current.patchProfiles({ current: "failure" }),
    ).rejects.toThrow(failure);

    expect(mutateProfilesMock).toHaveBeenCalledTimes(1);
  });

  it("patchCurrent updates the active profile when present", async () => {
    const profilesData = {
      current: "uid-1",
      items: [{ uid: "uid-1" }],
    };

    useSWRMock.mockReturnValue({
      data: profilesData,
      mutate: mutateProfilesMock,
      error: null,
      isValidating: false,
    });

    patchProfileMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useProfiles());

    await result.current.patchCurrent({ name: "Updated" });

    expect(patchProfileMock).toHaveBeenCalledWith(profilesData.current, {
      name: "Updated",
    });
    expect(mutateProfilesMock).toHaveBeenCalledTimes(1);
  });

  it("activateSelected reconciles saved selections with current proxies", async () => {
    vi.useFakeTimers();

    const profilesData = {
      current: "uid-1",
      items: [
        {
          uid: "uid-1",
          selected: [
            { name: "Global", now: "ProxyB" },
            { name: "GroupA", now: "ProxyY" },
          ],
        },
      ],
    };

    useSWRMock.mockReturnValue({
      data: profilesData,
      mutate: mutateProfilesMock,
      error: null,
      isValidating: false,
    });

    selectNodeForGroupMock.mockResolvedValue(undefined);
    patchProfileMock.mockResolvedValue(undefined);

    getProfilesMock.mockResolvedValue(profilesData);
    calcuProxiesMock.mockResolvedValue({
      global: {
        type: "Selector",
        name: "Global",
        now: "ProxyA",
        all: ["ProxyA", "ProxyB"],
      },
      groups: [
        {
          type: "Selector",
          name: "GroupA",
          now: "ProxyX",
          all: ["ProxyX", "ProxyY"],
        },
        {
          type: "Direct",
          name: "DirectLane",
          now: "DIRECT",
          all: [],
        },
      ],
    });

    const { result } = renderHook(() => useProfiles());

    await result.current.activateSelected();

    expect(selectNodeForGroupMock).toHaveBeenCalledWith("Global", "ProxyB");
    expect(selectNodeForGroupMock).toHaveBeenCalledWith("GroupA", "ProxyY");

    expect(patchProfileMock).toHaveBeenCalledWith("uid-1", {
      selected: [
        { name: "Global", now: "ProxyB" },
        { name: "GroupA", now: "ProxyY" },
        { name: "DirectLane", now: "DIRECT" },
      ],
    });

    await vi.runAllTimersAsync();

    expect(mutateMock).toHaveBeenCalled();
    const [key, promise] = mutateMock.mock.calls[0];
    expect(key).toBe("getProxies");
    expect(promise).toBeInstanceOf(Promise);

    vi.useRealTimers();
  });
});
