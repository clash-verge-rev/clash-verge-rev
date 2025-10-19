import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileItem } from "@/components/profile/profile-item";

const mocks = vi.hoisted(() => {
  const openMock = vi.fn();
  const mutateMock = vi.fn();
  const getNextUpdateTimeMock = vi.fn();
  const updateProfileMock = vi.fn();
  const viewProfileMock = vi.fn();
  const readProfileFileMock = vi.fn();
  const saveProfileFileMock = vi.fn();
  const confirmViewerSpy = vi.fn(
    ({
      open,
      onConfirm,
      onClose,
    }: {
      open: boolean;
      title: string;
      message: string;
      onClose: () => void;
      onConfirm: () => void;
    }) =>
      open ? (
        <div data-testid="confirm-viewer">
          <button type="button" onClick={onClose}>
            cancel-delete
          </button>
          <button type="button" onClick={onConfirm}>
            confirm-delete
          </button>
        </div>
      ) : null,
  );
  const loadingCacheState: Record<string, boolean> = {};
  type LoadingUpdater =
    | Record<string, boolean>
    | ((cache: Record<string, boolean>) => Record<string, boolean>);

  const setLoadingCacheMock = vi.fn((next: LoadingUpdater) => {
    const result =
      typeof next === "function"
        ? next({ ...loadingCacheState })
        : (next ?? {});
    Object.keys(loadingCacheState).forEach((key) => {
      delete loadingCacheState[key];
    });
    Object.assign(loadingCacheState, result);
  });

  return {
    openMock,
    mutateMock,
    getNextUpdateTimeMock,
    updateProfileMock,
    viewProfileMock,
    readProfileFileMock,
    saveProfileFileMock,
    confirmViewerSpy,
    loadingCacheState,
    setLoadingCacheMock,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "",
    },
  },
}));

vi.mock("@mui/material", async () => {
  const React = await import("react");

  const Box = React.forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children, ...rest }, ref) => (
      <div ref={ref as React.Ref<HTMLDivElement>} {...rest}>
        {children}
      </div>
    ),
  );
  Box.displayName = "BoxMock";

  const Typography = ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  );

  const IconButton = ({
    children,
    onClick,
    disabled,
    title,
  }: {
    children?: ReactNode;
    onClick?: (event: any) => void;
    disabled?: boolean;
    title?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );

  const LinearProgress = ({ value }: { value?: number }) => (
    <div data-testid="linear-progress">{value}</div>
  );

  const CircularProgress = () => <div data-testid="circular-progress" />;

  const Menu = ({
    open,
    children,
  }: {
    open: boolean;
    children?: ReactNode;
  }) => {
    if (!open) return null;
    return <div role="menu">{children}</div>;
  };

  const MenuItem = ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );

  const keyframes = () => "mock-animation";

  return {
    Box,
    Typography,
    IconButton,
    LinearProgress,
    CircularProgress,
    Menu,
    MenuItem,
    keyframes,
  };
});

vi.mock("@mui/icons-material", () => ({
  RefreshRounded: () => <span>refresh</span>,
  DragIndicatorRounded: () => <span>drag</span>,
  CheckBoxRounded: () => <span>checked</span>,
  CheckBoxOutlineBlankRounded: () => <span>unchecked</span>,
}));

vi.mock("@/components/profile/profile-box", () => ({
  ProfileBox: ({ children, ...rest }: { children?: ReactNode }) => (
    <div data-testid="profile-box" {...rest}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/profile/confirm-viewer", () => ({
  ConfirmViewer: (props: any) => mocks.confirmViewerSpy(props),
}));

vi.mock("@/components/profile/editor-viewer", () => ({
  EditorViewer: () => <div data-testid="editor-viewer" />,
}));

vi.mock("@/components/profile/rules-editor-viewer", () => ({
  RulesEditorViewer: () => <div data-testid="rules-editor" />,
}));

vi.mock("@/components/profile/proxies-editor-viewer", () => ({
  ProxiesEditorViewer: () => <div data-testid="proxies-editor" />,
}));

vi.mock("@/components/profile/groups-editor-viewer", () => ({
  GroupsEditorViewer: () => <div data-testid="groups-editor" />,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => mocks.openMock(...args),
}));

vi.mock("swr", () => ({
  mutate: (...args: unknown[]) => mocks.mutateMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  viewProfile: (...args: unknown[]) => mocks.viewProfileMock(...args),
  readProfileFile: (...args: unknown[]) => mocks.readProfileFileMock(...args),
  saveProfileFile: (...args: unknown[]) => mocks.saveProfileFileMock(...args),
  updateProfile: (...args: unknown[]) => mocks.updateProfileMock(...args),
  getNextUpdateTime: (...args: unknown[]) =>
    mocks.getNextUpdateTimeMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: vi.fn(),
}));

vi.mock("@/services/states", () => ({
  useLoadingCache: () => mocks.loadingCacheState,
  useSetLoadingCache: () => mocks.setLoadingCacheMock,
}));

vi.mock("dayjs", () => {
  const mockDay = (value?: number) => ({
    fromNow: () => "from-now",
    format: () => "formatted",
    diff: () => 5,
    isBefore: () => false,
    value,
  });
  return {
    __esModule: true,
    default: Object.assign(mockDay, { extend: vi.fn() }),
  };
});

vi.mock("@/utils/parse-traffic", () => ({
  __esModule: true,
  default: (value: number) => `${value}B`,
}));

type ProfileItemProps = Parameters<typeof ProfileItem>[0];

const createProps = (
  overrides: Partial<ProfileItemProps> = {},
): ProfileItemProps => {
  const defaultItem: IProfileItem = {
    uid: "profile-1",
    type: "remote",
    name: "Remote Profile",
    desc: "Remote description",
    url: "https://example.com/profile.yaml",
    option: {
      rules: "rules-1",
      proxies: "proxies-1",
      groups: "groups-1",
    },
    updated: 0,
  };

  return {
    id: "profile-1",
    selected: false,
    activating: false,
    itemData: { ...defaultItem, ...overrides.itemData },
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    batchMode: false,
    isSelected: false,
    onSelectionChange: vi.fn(),
    ...overrides,
  };
};

describe("ProfileItem", () => {
  const {
    confirmViewerSpy,
    setLoadingCacheMock,
    loadingCacheState,
    updateProfileMock,
    viewProfileMock,
    readProfileFileMock,
    saveProfileFileMock,
  } = mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(loadingCacheState).forEach((key) => {
      delete loadingCacheState[key];
    });
    updateProfileMock.mockResolvedValue(undefined);
    viewProfileMock.mockResolvedValue(undefined);
    readProfileFileMock.mockResolvedValue("");
    saveProfileFileMock.mockResolvedValue(undefined);
  });

  it("invokes onSelect when profile is clicked and not activating", async () => {
    const props = createProps();
    render(<ProfileItem {...props} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("profile-box"));

    expect(props.onSelect).toHaveBeenCalledWith(false);
  });

  it("prevents selection click while activating", async () => {
    const props = createProps({ activating: true });
    render(<ProfileItem {...props} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("profile-box"));

    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("toggles batch selection using the checkbox button", async () => {
    const props = createProps({
      batchMode: true,
      onSelectionChange: vi.fn(),
    });
    render(<ProfileItem {...props} />);

    const user = userEvent.setup();
    const toggleButton = screen.getByRole("button", { name: /unchecked/i });
    await user.click(toggleButton);

    expect(props.onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("opens confirm dialog and calls onDelete through context menu", async () => {
    const props = createProps();
    render(<ProfileItem {...props} />);

    const user = userEvent.setup();
    const box = screen.getByTestId("profile-box");
    fireEvent.contextMenu(box);

    const menu = await screen.findByRole("menu");
    const deleteItem = within(menu).getByRole("menuitem", { name: "Delete" });
    await user.click(deleteItem);

    const confirmButton = await screen.findByRole("button", {
      name: "confirm-delete",
    });
    await user.click(confirmButton);

    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(confirmViewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("dispatches selection change when deleting in batch mode", async () => {
    const onSelectionChange = vi.fn();
    const props = createProps({
      batchMode: true,
      onSelectionChange,
    });
    render(<ProfileItem {...props} />);

    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByTestId("profile-box"));
    const menu = await screen.findByRole("menu");
    const deleteItem = within(menu).getByRole("menuitem", { name: "Delete" });
    await user.click(deleteItem);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-viewer")).not.toBeInTheDocument();
  });

  it("invokes updateProfile through refresh action", async () => {
    const props = createProps();
    render(<ProfileItem {...props} />);

    const user = userEvent.setup();
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    await user.click(refreshButton);

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1));
    expect(updateProfileMock).toHaveBeenCalledWith("profile-1", {});

    await waitFor(() => expect(setLoadingCacheMock).toHaveBeenCalledTimes(2));
    expect(loadingCacheState["profile-1"]).toBe(false);
  });
});
