import { renderHook } from "@testing-library/react";
import {
  closeConnections,
  getConnections,
  selectNodeForGroup,
} from "tauri-plugin-mihomo-api";
import type { MockedFunction } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useProfiles } from "@/hooks/use-profiles";
import { useProxySelection } from "@/hooks/use-proxy-selection";
import { useVerge } from "@/hooks/use-verge";
import { syncTrayProxySelection } from "@/services/cmds";

vi.mock("tauri-plugin-mihomo-api", () => ({
  selectNodeForGroup: vi.fn(),
  getConnections: vi.fn(),
  closeConnections: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({
  syncTrayProxySelection: vi.fn(),
}));

vi.mock("@/hooks/use-profiles", () => ({
  useProfiles: vi.fn(),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: vi.fn(),
}));

const selectNodeForGroupMock = selectNodeForGroup as MockedFunction<
  typeof selectNodeForGroup
>;
const getConnectionsMock = getConnections as MockedFunction<
  typeof getConnections
>;
const closeConnectionsMock = closeConnections as MockedFunction<
  typeof closeConnections
>;
const syncTrayProxySelectionMock = syncTrayProxySelection as MockedFunction<
  typeof syncTrayProxySelection
>;
const useProfilesMock = useProfiles as MockedFunction<typeof useProfiles>;
const useVergeMock = useVerge as MockedFunction<typeof useVerge>;

const createUseVergeValue = (
  overrides: Partial<NonNullable<ReturnType<typeof useVerge>["verge"]>>,
): ReturnType<typeof useVerge> =>
  ({
    verge: overrides as NonNullable<ReturnType<typeof useVerge>["verge"]>,
    mutateVerge: vi.fn(),
    patchVerge: vi.fn(),
  }) as ReturnType<typeof useVerge>;

describe("useProxySelection", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("updates profile selection and synchronises the tray on success", async () => {
    const patchCurrent = vi.fn().mockResolvedValue(undefined);
    const current = {
      uid: "profile-1",
      selected: [{ name: "GroupA", now: "OldProxy" }],
    };

    useProfilesMock.mockReturnValue({
      current,
      patchCurrent,
    } as unknown as ReturnType<typeof useProfiles>);
    useVergeMock.mockReturnValue(
      createUseVergeValue({ auto_close_connection: false }),
    );
    selectNodeForGroupMock.mockResolvedValue(undefined);
    syncTrayProxySelectionMock.mockResolvedValue(undefined);

    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useProxySelection({ onSuccess, enableConnectionCleanup: true }),
    );

    await result.current.changeProxy("GroupA", "NewProxy", "OldProxy");

    expect(patchCurrent).toHaveBeenCalledWith({
      selected: [{ name: "GroupA", now: "NewProxy" }],
    });
    expect(selectNodeForGroupMock).toHaveBeenCalledWith("GroupA", "NewProxy");
    expect(syncTrayProxySelectionMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(getConnectionsMock).not.toHaveBeenCalled();
  });

  it("cleans up previous connections when auto close is enabled", async () => {
    vi.useFakeTimers();

    const patchCurrent = vi.fn().mockResolvedValue(undefined);
    const current = {
      uid: "profile-1",
      selected: [] as Array<{ name: string; now: string }>,
    };

    useProfilesMock.mockReturnValue({
      current,
      patchCurrent,
    } as unknown as ReturnType<typeof useProfiles>);
    useVergeMock.mockReturnValue(
      createUseVergeValue({ auto_close_connection: true }),
    );
    selectNodeForGroupMock.mockResolvedValue(undefined);
    syncTrayProxySelectionMock.mockResolvedValue(undefined);
    getConnectionsMock.mockResolvedValue({
      downloadTotal: 0,
      uploadTotal: 0,
      memory: 0,
      connections: [
        { id: "1", chains: ["OldProxy", "Other"] } as any,
        { id: "2", chains: ["Different"] } as any,
      ],
    });
    closeConnectionsMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useProxySelection());

    await result.current.changeProxy("GroupA", "NewProxy", "OldProxy");

    await vi.runAllTimersAsync();

    expect(getConnectionsMock).toHaveBeenCalledTimes(1);
    expect(closeConnectionsMock).toHaveBeenCalledTimes(1);
    expect(closeConnectionsMock).toHaveBeenCalledWith("1");
  });

  it("surfaces errors when both primary and fallback selections fail", async () => {
    const patchCurrent = vi.fn().mockResolvedValue(undefined);
    const current = {
      uid: "profile-1",
      selected: [] as Array<{ name: string; now: string }>,
    };

    useProfilesMock.mockReturnValue({
      current,
      patchCurrent,
    } as unknown as ReturnType<typeof useProfiles>);
    useVergeMock.mockReturnValue(
      createUseVergeValue({ auto_close_connection: false }),
    );

    const firstError = new Error("primary failure");
    const fallbackError = new Error("fallback failure");

    selectNodeForGroupMock.mockRejectedValueOnce(firstError);
    selectNodeForGroupMock.mockRejectedValueOnce(fallbackError);
    syncTrayProxySelectionMock.mockResolvedValue(undefined);

    const onError = vi.fn();

    const { result } = renderHook(() =>
      useProxySelection({ onError, enableConnectionCleanup: false }),
    );

    await result.current.changeProxy("GroupA", "NewProxy", "OldProxy");

    expect(patchCurrent).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(fallbackError);
    expect(syncTrayProxySelectionMock).not.toHaveBeenCalled();
  });
});
