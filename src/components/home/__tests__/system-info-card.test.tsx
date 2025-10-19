import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SystemInfoCard } from "@/components/home/system-info-card";

const { useVergeMock } = vi.hoisted(() => ({ useVergeMock: vi.fn() }));
const { useSystemStateMock } = vi.hoisted(() => ({
  useSystemStateMock: vi.fn(),
}));
const { useServiceInstallerMock } = vi.hoisted(() => ({
  useServiceInstallerMock: vi.fn(),
}));
const { getSystemInfoMock } = vi.hoisted(() => ({
  getSystemInfoMock: vi.fn(),
}));
const { showNoticeMock } = vi.hoisted(() => ({
  showNoticeMock: vi.fn(),
}));
const { checkUpdateMock } = vi.hoisted(() => ({
  checkUpdateMock: vi.fn(),
}));
const { useSWRMock } = vi.hoisted(() => ({ useSWRMock: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/home/enhanced-card", () => ({
  EnhancedCard: ({
    title,
    action,
    children,
  }: {
    title: ReactNode;
    action: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="enhanced-card">
      <div data-testid="card-title">{title}</div>
      <div data-testid="card-action">{action}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("ahooks", () => ({
  useLockFn: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: useVergeMock,
}));

vi.mock("@/hooks/use-system-state", () => ({
  useSystemState: useSystemStateMock,
}));

vi.mock("@/hooks/useServiceInstaller", () => ({
  useServiceInstaller: useServiceInstallerMock,
}));

vi.mock("@/services/cmds", () => ({
  getSystemInfo: getSystemInfoMock,
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: showNoticeMock,
}));

vi.mock("@/services/update", () => ({
  checkUpdateSafe: checkUpdateMock,
}));

vi.mock("@root/package.json", () => ({
  version: "9.9.9",
}));

vi.mock("swr", () => ({
  default: useSWRMock,
}));

const createVergeValue = (
  overrides: Partial<
    NonNullable<ReturnType<typeof useVergeMock>["verge"]>
  > = {},
) =>
  ({
    verge: {
      enable_auto_launch: false,
      auto_check_update: false,
      ...overrides,
    },
    patchVerge: vi.fn(),
  }) as unknown as ReturnType<typeof useVergeMock>;

const createSystemStateValue = (
  overrides: Partial<ReturnType<typeof useSystemStateMock>> = {},
) =>
  ({
    isAdminMode: false,
    isSidecarMode: false,
    isServiceMode: false,
    isServiceOk: false,
    ...overrides,
  }) as ReturnType<typeof useSystemStateMock>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockNavigate.mockReset();
  getSystemInfoMock.mockResolvedValue(
    "System: Windows\nVersion: Windows 11 Pro",
  );
  useSWRMock.mockReturnValue({
    data: undefined,
    error: undefined,
    mutate: vi.fn(),
    isLoading: false,
    isValidating: false,
  });
});

describe("SystemInfoCard", () => {
  it("returns null when verge data is unavailable", () => {
    useVergeMock.mockReturnValue({ verge: null } as ReturnType<
      typeof useVergeMock
    >);
    useSystemStateMock.mockReturnValue(
      createSystemStateValue() as ReturnType<typeof useSystemStateMock>,
    );
    useServiceInstallerMock.mockReturnValue({
      installServiceAndRestartCore: vi.fn(),
    });

    const { container } = render(<SystemInfoCard />);

    expect(container.firstChild).toBeNull();
  });

  it("renders system information and toggles auto launch", async () => {
    const vergeValue = createVergeValue();
    const patchVergeMock = vi.fn();
    useVergeMock.mockReturnValue({
      ...vergeValue,
      patchVerge: patchVergeMock,
    } as ReturnType<typeof useVergeMock>);

    useSystemStateMock.mockReturnValue(
      createSystemStateValue() as ReturnType<typeof useSystemStateMock>,
    );

    useServiceInstallerMock.mockReturnValue({
      installServiceAndRestartCore: vi.fn(),
    });

    render(<SystemInfoCard />);

    await waitFor(() =>
      expect(screen.getByText("Windows 11 Pro")).toBeInTheDocument(),
    );
    expect(getSystemInfoMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("System Info")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Disabled"));

    await waitFor(() =>
      expect(patchVergeMock).toHaveBeenCalledWith({
        enable_auto_launch: true,
      }),
    );
  });

  it("invokes installer when running mode is clicked in sidecar admin mode", async () => {
    const installMock = vi.fn();
    useVergeMock.mockReturnValue(
      createVergeValue({
        enable_auto_launch: true,
      }) as ReturnType<typeof useVergeMock>,
    );
    useSystemStateMock.mockReturnValue(
      createSystemStateValue({
        isAdminMode: true,
        isSidecarMode: true,
      }) as ReturnType<typeof useSystemStateMock>,
    );
    useServiceInstallerMock.mockReturnValue({
      installServiceAndRestartCore: installMock,
    });

    render(<SystemInfoCard />);

    const runningMode = await screen.findByText("Administrator Mode", {
      selector: "p",
    });

    fireEvent.click(runningMode);

    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it("checks for updates and shows notification", async () => {
    const lastCheckTimestamp = Date.now() - 1000;
    localStorage.setItem("last_check_update", `${lastCheckTimestamp}`);
    const expectedLastCheck = new Date(lastCheckTimestamp).toLocaleString();
    checkUpdateMock.mockResolvedValue({ available: false });

    const vergeValue = createVergeValue();
    useVergeMock.mockReturnValue(vergeValue as ReturnType<typeof useVergeMock>);
    useSystemStateMock.mockReturnValue(
      createSystemStateValue() as ReturnType<typeof useSystemStateMock>,
    );
    useServiceInstallerMock.mockReturnValue({
      installServiceAndRestartCore: vi.fn(),
    });

    render(<SystemInfoCard />);

    await waitFor(() =>
      expect(screen.getByText(expectedLastCheck)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText(expectedLastCheck));

    await waitFor(() => expect(checkUpdateMock).toHaveBeenCalledTimes(1));
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Currently on the Latest Version",
    );
  });
});
