import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClashModeCard } from "@/components/home/clash-mode-card";
import { useVerge } from "@/hooks/use-verge";
import { useAppData } from "@/providers/app-data-context";

const { closeAllConnectionsMock } = vi.hoisted(() => ({
  closeAllConnectionsMock: vi.fn(),
}));

const { patchClashModeMock } = vi.hoisted(() => ({
  patchClashModeMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@mui/material", async () => {
  const actual =
    await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    Paper: ({ onClick, children, ...rest }: any) => (
      <div role="button" onClick={onClick} {...rest}>
        {children}
      </div>
    ),
  };
});

vi.mock("ahooks", () => ({
  useLockFn: (fn: (...args: unknown[]) => Promise<unknown> | unknown) => fn,
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeAllConnections: closeAllConnectionsMock,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: vi.fn(),
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({
  patchClashMode: patchClashModeMock,
}));

const useVergeMock = vi.mocked(useVerge);
const useAppDataMock = vi.mocked(useAppData);

const createAppDataValue = ({
  mode = "rule",
  refreshClashConfig = vi.fn(),
}: {
  mode?: string;
  refreshClashConfig?: ReturnType<typeof vi.fn>;
}) =>
  ({
    clashConfig: { mode },
    refreshClashConfig,
  }) as unknown as ReturnType<typeof useAppData>;

describe("ClashModeCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVergeMock.mockReturnValue({
      verge: { auto_close_connection: false },
    } as ReturnType<typeof useVerge>);
    useAppDataMock.mockReturnValue(
      createAppDataValue({ mode: "rule" }) as ReturnType<typeof useAppData>,
    );
    patchClashModeMock.mockResolvedValue(undefined);
  });

  it("renders available modes and highlights current mode description", () => {
    render(<ClashModeCard />);

    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("rule")).toBeInTheDocument();
    expect(screen.getByText("global")).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(
      screen.getByText("Rule Mode Description", { exact: false }),
    ).toBeInTheDocument();
  });

  it("switches to a different mode and refreshes config", async () => {
    const refreshClashConfig = vi.fn();
    useAppDataMock.mockReturnValue(
      createAppDataValue({ mode: "rule", refreshClashConfig }) as ReturnType<
        typeof useAppData
      >,
    );

    render(<ClashModeCard />);

    fireEvent.click(screen.getByText("global"));

    await waitFor(() => {
      expect(patchClashModeMock).toHaveBeenCalledWith("global");
      expect(refreshClashConfig).toHaveBeenCalled();
    });
    expect(closeAllConnectionsMock).not.toHaveBeenCalled();
  });

  it("closes existing connections before switching when auto close enabled", () => {
    useVergeMock.mockReturnValue({
      verge: { auto_close_connection: true },
    } as ReturnType<typeof useVerge>);

    render(<ClashModeCard />);

    fireEvent.click(screen.getByText("global"));

    expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
  });

  it("does not trigger updates when selecting the current mode again", () => {
    render(<ClashModeCard />);

    fireEvent.click(screen.getByText("rule"));

    expect(patchClashModeMock).not.toHaveBeenCalled();
    expect(closeAllConnectionsMock).not.toHaveBeenCalled();
  });
});
