import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestItem } from "@/components/test/test-item";

const mocks = vi.hoisted(() => {
  const cmdTestDelayMock = vi.fn<(url: string) => Promise<number>>();
  const downloadIconCacheMock =
    vi.fn<(icon: string, fileName: string) => Promise<string>>();
  const showNoticeMock = vi.fn<(type: string, message: string) => void>();
  const convertFileSrcMock = vi.fn<(path: string) => string>();
  const formatDelayMock = vi.fn<(value: number) => string>();
  const formatDelayColorMock = vi.fn<(value: number) => string>();
  const setNodeRefMock = vi.fn();
  const useSortableMock = vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: setNodeRefMock,
    transform: null,
    transition: null,
    isDragging: false,
  }));

  let listener: (() => void) | undefined;
  const addListenerMock = vi.fn(async (_event: string, handler: () => void) => {
    listener = handler;
    return vi.fn();
  });

  return {
    cmdTestDelayMock,
    downloadIconCacheMock,
    showNoticeMock,
    convertFileSrcMock,
    formatDelayMock,
    formatDelayColorMock,
    useSortableMock,
    setNodeRefMock,
    addListenerMock,
    getListener: () => listener,
    setListener: (handler: () => void) => {
      listener = handler;
    },
    clearListener: () => {
      listener = undefined;
    },
  };
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: mocks.useSortableMock,
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "matrix(1, 0, 0, 1, 0, 0)",
    },
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (...args: Parameters<typeof mocks.convertFileSrcMock>) =>
    mocks.convertFileSrcMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/hooks/use-listen", () => ({
  useListen: () => ({
    addListener: (...args: Parameters<typeof mocks.addListenerMock>) =>
      mocks.addListenerMock(...args),
  }),
}));

vi.mock("@/services/cmds", () => ({
  cmdTestDelay: (...args: Parameters<typeof mocks.cmdTestDelayMock>) =>
    mocks.cmdTestDelayMock(...args),
  downloadIconCache: (
    ...args: Parameters<typeof mocks.downloadIconCacheMock>
  ) => mocks.downloadIconCacheMock(...args),
}));

vi.mock("@/services/delay", () => ({
  __esModule: true,
  default: {
    formatDelay: (...args: Parameters<typeof mocks.formatDelayMock>) =>
      mocks.formatDelayMock(...args),
    formatDelayColor: (
      ...args: Parameters<typeof mocks.formatDelayColorMock>
    ) => mocks.formatDelayColorMock(...args),
  },
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: Parameters<typeof mocks.showNoticeMock>) =>
    mocks.showNoticeMock(...args),
}));

vi.mock("@/components/base", () => ({
  BaseLoading: () => <div data-testid="base-loading" />,
}));

vi.mock("@/components/test/test-box", () => ({
  TestBox: ({
    children,
    ...rest
  }: {
    children: ReactNode;
    onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  }) => (
    <div data-testid="test-box" {...rest}>
      {children}
    </div>
  ),
}));

vi.mock("@mui/material", async () => {
  const original = await vi.importActual<any>("@mui/material");

  return {
    ...original,
    Menu: ({
      open,
      children,
      onClose,
      onContextMenu,
    }: {
      open: boolean;
      children: ReactNode;
      onClose?: () => void;
      onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
    }) =>
      open ? (
        <div
          data-testid="test-item-menu"
          onClick={onClose}
          onContextMenu={onContextMenu}
        >
          {children}
        </div>
      ) : null,
    MenuItem: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

describe("TestItem", () => {
  const {
    cmdTestDelayMock,
    downloadIconCacheMock,
    convertFileSrcMock,
    formatDelayMock,
    formatDelayColorMock,
    showNoticeMock,
    addListenerMock,
    clearListener,
  } = mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    clearListener();
    cmdTestDelayMock.mockResolvedValue(150);
    downloadIconCacheMock.mockResolvedValue("C:/cache/icon.png");
    convertFileSrcMock.mockImplementation((path) => `converted://${path}`);
    formatDelayMock.mockImplementation((value) => `${value}ms`);
    formatDelayColorMock.mockReturnValue("green");
    addListenerMock.mockImplementation(async (_event, handler) => {
      clearListener();
      mocks.setListener(handler);
      return vi.fn();
    });
  });

  const renderItem = (override?: Partial<IVergeTestItem>) =>
    render(
      <TestItem
        id="test-item"
        itemData={{
          uid: "test-uid",
          name: "Sample",
          icon: "",
          url: "https://example.com",
          ...override,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

  it("downloads remote icon and renders cached image", async () => {
    downloadIconCacheMock.mockResolvedValueOnce("C:/cache/remote.png");

    renderItem({ icon: "http://example.com/icon.png" });

    await waitFor(() =>
      expect(downloadIconCacheMock).toHaveBeenCalledWith(
        "http://example.com/icon.png",
        "test-uid-icon.png",
      ),
    );

    const icon = await screen.findByRole("img");
    expect(convertFileSrcMock).toHaveBeenCalledWith("C:/cache/remote.png");
    expect(icon).toHaveAttribute("src", "converted://C:/cache/remote.png");
  });

  it("invokes delay check when clicking Test and shows formatted delay", async () => {
    cmdTestDelayMock.mockResolvedValueOnce(321);

    renderItem();

    const user = userEvent.setup();
    await user.click(screen.getByText("Test"));

    await waitFor(() =>
      expect(cmdTestDelayMock).toHaveBeenCalledWith("https://example.com"),
    );
    await waitFor(() => expect(screen.getByText("321ms")).toBeInTheDocument());
    expect(formatDelayColorMock).toHaveBeenCalledWith(321);
  });

  it("exposes context menu actions for edit and delete", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <TestItem
        id="test-item"
        itemData={{
          uid: "test-uid",
          name: "Sample",
          icon: "",
          url: "https://example.com",
        }}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    const user = userEvent.setup();
    const target = screen.getByTestId("test-box");

    fireEvent.contextMenu(target);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(target);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("test-uid");
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it("re-checks delay when verge test-all event fires", async () => {
    cmdTestDelayMock.mockResolvedValueOnce(88);

    renderItem();

    await waitFor(() => expect(addListenerMock).toHaveBeenCalled());

    const listener = mocks.getListener();
    expect(listener).toBeDefined();

    await act(async () => {
      listener?.();
    });

    await waitFor(() =>
      expect(cmdTestDelayMock).toHaveBeenCalledWith("https://example.com"),
    );
    await waitFor(() => expect(screen.getByText("88ms")).toBeInTheDocument());
  });
});
