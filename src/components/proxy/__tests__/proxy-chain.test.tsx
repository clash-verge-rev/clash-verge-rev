import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProxyChain } from "@/components/proxy/proxy-chain";

const {
  swrMock,
  useAppDataMock,
  updateProxyChainConfigInRuntimeMock,
  selectNodeForGroupMock,
  closeAllConnectionsMock,
} = vi.hoisted(() => ({
  swrMock: vi.fn(),
  useAppDataMock: vi.fn(),
  updateProxyChainConfigInRuntimeMock: vi.fn(),
  selectNodeForGroupMock: vi.fn(),
  closeAllConnectionsMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MockDndContext = ({ children }: { children: ReactNode }) => (
  <div data-testid="dnd-context">{children}</div>
);

const MockSortableContext = ({ children }: { children: ReactNode }) => (
  <>{children}</>
);

vi.mock("@dnd-kit/core", () => ({
  closestCenter: vi.fn(),
  DndContext: MockDndContext,
  DragEndEvent: vi.fn(),
  useSensor: vi.fn((factory: unknown) => factory),
  useSensors: (...args: unknown[]) => args,
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: <T,>(items: T[]) => items,
  SortableContext: MockSortableContext,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@/providers/app-data-context", () => ({
  useAppData: () => useAppDataMock(),
}));

vi.mock("@/services/cmds", () => ({
  calcuProxies: vi.fn(),
  updateProxyChainConfigInRuntime: (...args: unknown[]) =>
    updateProxyChainConfigInRuntimeMock(...args),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: swrMock,
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeAllConnections: (...args: unknown[]) => closeAllConnectionsMock(...args),
  selectNodeForGroup: (...args: unknown[]) => selectNodeForGroupMock(...args),
}));

const renderProxyChain = (
  props: Partial<React.ComponentProps<typeof ProxyChain>> = {},
) => {
  const defaultProps: React.ComponentProps<typeof ProxyChain> = {
    proxyChain: [],
    onUpdateChain: vi.fn(),
    chainConfigData: undefined,
    onMarkUnsavedChanges: vi.fn(),
    mode: "global",
    selectedGroup: null,
  };

  return render(<ProxyChain {...defaultProps} {...props} />);
};

describe("ProxyChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppDataMock.mockReturnValue({ proxies: undefined });
    swrMock.mockReturnValue({ data: null, mutate: vi.fn() });
    updateProxyChainConfigInRuntimeMock.mockResolvedValue(undefined);
    selectNodeForGroupMock.mockResolvedValue(undefined);
    closeAllConnectionsMock.mockResolvedValue(undefined);
  });

  it("shows empty state and disabled connect button when no proxies in chain", () => {
    renderProxyChain();

    expect(screen.getByText("No proxy chain configured")).toBeInTheDocument();
    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton).toBeDisabled();
    expect(screen.queryByTitle("Delete Chain Config")).not.toBeInTheDocument();
  });

  it("clears chain via delete button", () => {
    const onUpdateChain = vi.fn();

    renderProxyChain({
      proxyChain: [
        { id: "1", name: "NodeA" },
        { id: "2", name: "NodeB" },
      ],
      onUpdateChain,
    });

    const deleteButton = screen.getByTitle("Delete Chain Config");
    fireEvent.click(deleteButton);

    expect(updateProxyChainConfigInRuntimeMock).toHaveBeenCalledWith(null);
    expect(onUpdateChain).toHaveBeenCalledWith([]);
  });

  it("disconnects when chain already connected", async () => {
    const mutate = vi.fn();
    swrMock.mockReturnValue({
      data: { global: { now: "NodeB" } },
      mutate,
    });

    renderProxyChain({
      proxyChain: [
        { id: "1", name: "NodeA" },
        { id: "2", name: "NodeB" },
      ],
    });

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    fireEvent.click(disconnectButton);

    await waitFor(() => {
      expect(updateProxyChainConfigInRuntimeMock).toHaveBeenCalledWith(null);
      expect(closeAllConnectionsMock).toHaveBeenCalledTimes(1);
    });
    expect(mutate).toHaveBeenCalled();
    expect(selectNodeForGroupMock).not.toHaveBeenCalled();
  });

  it("connects to chain when not connected", async () => {
    const mutate = vi.fn();
    swrMock.mockReturnValue({
      data: { global: { now: "OtherNode" } },
      mutate,
    });
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, "setItem");

    renderProxyChain({
      proxyChain: [
        { id: "1", name: "NodeA" },
        { id: "2", name: "NodeB" },
      ],
    });

    const connectButton = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(updateProxyChainConfigInRuntimeMock).toHaveBeenCalledWith([
        "NodeA",
        "NodeB",
      ]);
      expect(selectNodeForGroupMock).toHaveBeenCalledWith("GLOBAL", "NodeB");
    });

    expect(mutate).toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalledWith("proxy-chain-group", "GLOBAL");
    expect(setItemSpy).toHaveBeenCalledWith("proxy-chain-exit-node", "NodeB");
    setItemSpy.mockRestore();
  });
});
