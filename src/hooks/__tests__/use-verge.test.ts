import { renderHook, waitFor } from "@testing-library/react";
import useSWR from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { useSystemState } from "@/hooks/use-system-state";
import { useVerge } from "@/hooks/use-verge";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-system-state", () => ({
  useSystemState: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({
  getVergeConfig: vi.fn(),
  patchVergeConfig: vi.fn(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: vi.fn(),
}));

vi.mock("swr", () => {
  const swrMock = vi.fn();
  return { default: swrMock };
});

const useSystemStateMock = vi.mocked(useSystemState);
const useSWRMock = vi.mocked(useSWR);
const getVergeConfigMock = getVergeConfig as unknown as Mock;
const patchVergeConfigMock = patchVergeConfig as unknown as Mock;
const showNoticeMock = showNotice as unknown as Mock;

type UseSystemStateReturn = ReturnType<typeof useSystemState>;
type UseSWRReturn = ReturnType<typeof useSWR>;

const createSystemStateValue = (
  overrides: Partial<UseSystemStateReturn> = {},
): UseSystemStateReturn => ({
  runningMode: "Sidecar",
  isAdminMode: false,
  isSidecarMode: true,
  isServiceMode: false,
  isServiceOk: false,
  isTunModeAvailable: false,
  mutateRunningMode: vi.fn(),
  mutateServiceOk: vi.fn(),
  mutateTunModeAvailable: vi.fn(),
  isLoading: false,
  ...overrides,
});

const createSWRResponse = (
  overrides: Partial<UseSWRReturn> = {},
): UseSWRReturn =>
  ({
    data: undefined,
    error: undefined,
    mutate: vi.fn() as unknown as UseSWRReturn["mutate"],
    isLoading: false,
    isValidating: false,
    ...overrides,
  }) as UseSWRReturn;

describe("useVerge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns verge data and patchVerge triggers mutate", async () => {
    const mutateVerge = vi.fn();
    useSystemStateMock.mockReturnValue(
      createSystemStateValue({ isTunModeAvailable: true }),
    );
    getVergeConfigMock.mockResolvedValue({
      enable_tun_mode: false,
    });
    useSWRMock.mockReturnValue(
      createSWRResponse({
        data: { enable_tun_mode: false },
        mutate: mutateVerge as unknown as UseSWRReturn["mutate"],
      }),
    );
    patchVergeConfigMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVerge());

    await result.current.patchVerge({ auto_check_update: true });

    expect(patchVergeConfig).toHaveBeenCalledWith({ auto_check_update: true });
    expect(mutateVerge).toHaveBeenCalledTimes(1);
  });

  it("auto-disables TUN mode and shows notice when service unavailable", async () => {
    const mutateVerge = vi.fn();
    useSystemStateMock.mockReturnValue(
      createSystemStateValue({ isTunModeAvailable: false }),
    );
    useSWRMock.mockReturnValue(
      createSWRResponse({
        data: { enable_tun_mode: true },
        mutate: mutateVerge as unknown as UseSWRReturn["mutate"],
      }),
    );

    patchVergeConfigMock.mockResolvedValue(undefined);

    renderHook(() => useVerge());

    await waitFor(() => {
      expect(patchVergeConfig).toHaveBeenCalledWith({ enable_tun_mode: false });
      expect(mutateVerge).toHaveBeenCalled();
      expect(showNoticeMock).toHaveBeenCalledWith(
        "info",
        "TUN Mode automatically disabled due to service unavailable",
      );
    });
  });
});
