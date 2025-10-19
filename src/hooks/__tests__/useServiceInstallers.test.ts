import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useServiceInstaller } from "@/hooks/useServiceInstaller";
import { useServiceUninstaller } from "@/hooks/useServiceUninstaller";

const {
  installServiceMock,
  restartCoreMock,
  stopCoreMock,
  uninstallServiceMock,
  showNoticeMock,
  useSystemStateMock,
  mutateRunningModeMock,
  mutateServiceOkMock,
} = vi.hoisted(() => ({
  installServiceMock: vi.fn(),
  restartCoreMock: vi.fn(),
  stopCoreMock: vi.fn(),
  uninstallServiceMock: vi.fn(),
  showNoticeMock: vi.fn(),
  useSystemStateMock: vi.fn(),
  mutateRunningModeMock: vi.fn(),
  mutateServiceOkMock: vi.fn(),
}));

vi.mock("i18next", () => ({
  t: (value: string) => value,
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  installService: (...args: unknown[]) => installServiceMock(...args),
  restartCore: (...args: unknown[]) => restartCoreMock(...args),
  stopCore: (...args: unknown[]) => stopCoreMock(...args),
  uninstallService: (...args: unknown[]) => uninstallServiceMock(...args),
}));

vi.mock("@/hooks/use-system-state", () => ({
  useSystemState: () => useSystemStateMock(),
}));

describe("useServiceInstaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    installServiceMock.mockResolvedValue(undefined);
    restartCoreMock.mockResolvedValue(undefined);
    useSystemStateMock.mockReturnValue({
      mutateRunningMode: mutateRunningModeMock,
      mutateServiceOk: mutateServiceOkMock,
    });
    mutateRunningModeMock.mockResolvedValue(undefined);
    mutateServiceOkMock.mockResolvedValue(undefined);
  });

  it("runs install and restart flow with notices", async () => {
    const { result } = renderHook(() => useServiceInstaller());

    await result.current.installServiceAndRestartCore();

    expect(installServiceMock).toHaveBeenCalledTimes(1);
    expect(restartCoreMock).toHaveBeenCalledTimes(1);

    expect(showNoticeMock).toHaveBeenNthCalledWith(
      1,
      "info",
      "Installing Service...",
    );
    expect(showNoticeMock).toHaveBeenNthCalledWith(
      2,
      "success",
      "Service Installed Successfully",
    );
    expect(showNoticeMock).toHaveBeenNthCalledWith(
      3,
      "info",
      "Restarting Core...",
    );

    expect(mutateRunningModeMock).toHaveBeenCalledTimes(1);
    expect(mutateServiceOkMock).toHaveBeenCalledTimes(1);
  });

  it("propagates install failures after surfacing notice", async () => {
    installServiceMock.mockRejectedValue(new Error("install failed"));

    const { result } = renderHook(() => useServiceInstaller());

    await expect(result.current.installServiceAndRestartCore()).rejects.toThrow(
      "install failed",
    );

    expect(showNoticeMock).toHaveBeenCalledWith("error", "install failed");
    expect(restartCoreMock).not.toHaveBeenCalled();
    expect(mutateRunningModeMock).not.toHaveBeenCalled();
    expect(mutateServiceOkMock).not.toHaveBeenCalled();
  });
});

describe("useServiceUninstaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    stopCoreMock.mockResolvedValue(undefined);
    uninstallServiceMock.mockResolvedValue(undefined);
    restartCoreMock.mockResolvedValue(undefined);
    useSystemStateMock.mockReturnValue({
      mutateRunningMode: mutateRunningModeMock,
      mutateServiceOk: mutateServiceOkMock,
    });
    mutateRunningModeMock.mockResolvedValue(undefined);
    mutateServiceOkMock.mockResolvedValue(undefined);
  });

  it("runs uninstall flow and refreshes service status", async () => {
    const { result } = renderHook(() => useServiceUninstaller());

    await result.current.uninstallServiceAndRestartCore();

    expect(stopCoreMock).toHaveBeenCalledTimes(1);
    expect(uninstallServiceMock).toHaveBeenCalledTimes(1);
    expect(restartCoreMock).toHaveBeenCalledTimes(1);

    expect(showNoticeMock).toHaveBeenNthCalledWith(
      1,
      "info",
      "Stopping Core...",
    );
    expect(showNoticeMock).toHaveBeenNthCalledWith(
      2,
      "info",
      "Uninstalling Service...",
    );
    expect(showNoticeMock).toHaveBeenNthCalledWith(
      3,
      "success",
      "Service Uninstalled Successfully",
    );
    expect(showNoticeMock).toHaveBeenNthCalledWith(
      4,
      "info",
      "Restarting Core...",
    );

    expect(mutateRunningModeMock).toHaveBeenCalledTimes(1);
    expect(mutateServiceOkMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces uninstall errors and stops follow-up steps", async () => {
    uninstallServiceMock.mockRejectedValue(new Error("remove failed"));

    const { result } = renderHook(() => useServiceUninstaller());

    await expect(
      result.current.uninstallServiceAndRestartCore(),
    ).rejects.toThrow("remove failed");

    expect(showNoticeMock).toHaveBeenCalledWith("error", "remove failed");
    expect(restartCoreMock).not.toHaveBeenCalled();
    expect(mutateRunningModeMock).not.toHaveBeenCalled();
    expect(mutateServiceOkMock).not.toHaveBeenCalled();
  });
});
