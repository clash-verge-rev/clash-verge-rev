import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";
import {
  baseSearchBoxController,
  baseStyledSelectController,
} from "@/test/utils/base-controls-test-utils";

const mutateProfilesMock = vi.fn();
const mutateLogsMock = vi.fn();
const mutateMock = vi.fn();
const showNoticeMock = vi.fn();

const importProfileMock = vi.fn();
const patchProfilesMock = vi.fn();
const enhanceProfilesMock = vi.fn();
const deleteProfileMock = vi.fn();
const reorderProfileMock = vi.fn();
const createProfileMock = vi.fn();

const getProfilesMock = vi.fn();
const getRuntimeLogsMock = vi.fn();
const readTextMock = vi.fn();
const readTextFileMock = vi.fn();
const closeAllConnectionsMock = vi.fn();
const throttleMock = vi.fn((fn) => fn);
const listenMock = vi.fn(() => Promise.resolve(() => {}));
const eventOnceMock = vi.fn(() => Promise.resolve());

const profileViewerEditMock = vi.fn();
const profileItemRenderMock = vi.fn();

let useProfilesState: {
  profiles: IProfilesConfig;
  mutateProfiles: typeof mutateProfilesMock;
};

let useLocationValue = { state: undefined };

let dndContextProps: { onDragEnd?: (event: any) => void } | null = null;

vi.mock("lodash-es", () => ({
  throttle: (...args: Parameters<typeof throttleMock>) => throttleMock(...args),
}));

vi.mock("swr", () => {
  const useSWRMock = <T,>(
    key: string,
    fetcher: (...args: any[]) => Promise<T> | T,
  ) => {
    if (key === "getRuntimeLogs") {
      const data = getRuntimeLogsMock();
      return { data, mutate: mutateLogsMock };
    }

    if (typeof fetcher === "function") {
      const data = fetcher();
      return { data, mutate: vi.fn() };
    }

    return { data: undefined, mutate: vi.fn() };
  };

  return {
    __esModule: true,
    default: useSWRMock,
    mutate: (...args: Parameters<typeof mutateMock>) => mutateMock(...args),
  };
});

vi.mock("@/hooks/use-profiles", () => ({
  useProfiles: () => useProfilesState,
}));

const addListenerMock = vi.fn(() =>
  Promise.resolve(() => {
    /* noop */
  }),
);

vi.mock("@/hooks/use-listen", () => ({
  useListen: () => ({
    addListener: addListenerMock,
    setupCloseListener: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
  TauriEvent: {
    WINDOW_FOCUS: "tauri://focus",
    WINDOW_BLUR: "tauri://blur",
  },
}));

vi.mock("@tauri-apps/api", () => ({
  event: {
    once: (...args: Parameters<typeof eventOnceMock>) => eventOnceMock(...args),
  },
}));

vi.mock("@/services/states", () => ({
  useSetLoadingCache: () => vi.fn(),
  useThemeMode: () => "dark",
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: Parameters<typeof showNoticeMock>) =>
    showNoticeMock(...args),
}));

vi.mock("@/services/cmds", () => ({
  importProfile: (...args: Parameters<typeof importProfileMock>) =>
    importProfileMock(...args),
  patchProfiles: (...args: Parameters<typeof patchProfilesMock>) =>
    patchProfilesMock(...args),
  enhanceProfiles: (...args: Parameters<typeof enhanceProfilesMock>) =>
    enhanceProfilesMock(...args),
  deleteProfile: (...args: Parameters<typeof deleteProfileMock>) =>
    deleteProfileMock(...args),
  reorderProfile: (...args: Parameters<typeof reorderProfileMock>) =>
    reorderProfileMock(...args),
  getProfiles: (...args: Parameters<typeof getProfilesMock>) =>
    getProfilesMock(...args),
  createProfile: (...args: Parameters<typeof createProfileMock>) =>
    createProfileMock(...args),
  getRuntimeLogs: (...args: Parameters<typeof getRuntimeLogsMock>) =>
    getRuntimeLogsMock(...args),
  updateProfile: vi.fn(),
  // restartCore: vi.fn(),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeAllConnections: (...args: Parameters<typeof closeAllConnectionsMock>) =>
    closeAllConnectionsMock(...args),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: (...args: Parameters<typeof readTextMock>) => readTextMock(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: Parameters<typeof readTextFileMock>) =>
    readTextFileMock(...args),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, ...props }: any) => {
    dndContextProps = { children, ...props };
    return <div data-testid="dnd-context">{children}</div>;
  },
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn((sensor) => sensor),
  useSensors: vi.fn((...args) => args),
  DragOverlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
}));

vi.mock("@/components/profile/profile-item", () => ({
  ProfileItem: ({
    itemData,
    onSelect,
    onDelete,
    batchMode,
    onSelectionChange,
    ...rest
  }: {
    itemData: IProfileItem;
    onSelect: (force: boolean) => void;
    onDelete: () => void;
    batchMode: boolean;
    onSelectionChange: () => void;
  }) => {
    profileItemRenderMock({
      itemData,
      onSelect,
      onDelete,
      batchMode,
      onSelectionChange,
      ...rest,
    });
    return (
      <div data-testid={`profile-item-${itemData.uid}`}>
        <button
          type="button"
          onClick={() => onSelect(false)}
          data-testid={`activate-${itemData.uid}`}
        >
          activate
        </button>
        <button
          type="button"
          onClick={() => onDelete()}
          data-testid={`delete-${itemData.uid}`}
        >
          delete
        </button>
        {batchMode && (
          <button
            type="button"
            onClick={() => onSelectionChange()}
            data-testid={`select-${itemData.uid}`}
          >
            select
          </button>
        )}
      </div>
    );
  },
}));

vi.mock("@/components/profile/profile-more", () => ({
  ProfileMore: ({ id }: { id: string }) => (
    <div data-testid={`profile-more-${id}`} />
  ),
}));

vi.mock("@/components/profile/profile-viewer", () => ({
  ProfileViewer: forwardRef((props: { onChange: () => void }, ref) => {
    const { onChange } = props;
    useImperativeHandle(ref, () => ({
      create: vi.fn(),
      edit: profileViewerEditMock,
    }));
    void onChange;
    return <div data-testid="profile-viewer" />;
  }),
}));

vi.mock("@/components/setting/mods/config-viewer", () => ({
  ConfigViewer: forwardRef((_props: any, ref) => {
    useImperativeHandle(ref, () => ({
      open: vi.fn(),
    }));
    return <div data-testid="config-viewer" />;
  }),
}));

vi.mock("@/components/base/base-styled-text-field", () => ({
  BaseStyledTextField: ({ value, onChange, onKeyDown, slotProps }: any) => (
    <div data-testid="profile-url-input">
      <input
        data-testid="profile-url-input-field"
        value={value}
        onChange={(e) => onChange?.({ target: { value: e.target.value } })}
        onKeyDown={(e) => onKeyDown?.(e)}
      />
      <button
        type="button"
        data-testid="profile-url-clear"
        onClick={slotProps?.input?.endAdornment?.props?.onClick}
      >
        {slotProps?.input?.endAdornment ? "clear" : "paste"}
      </button>
    </div>
  ),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => useLocationValue,
}));

const ProfilePageModule = await import("@/pages/profiles");
const ProfilePage = ProfilePageModule.default;

const makeProfileConfig = (
  items: Partial<IProfileItem>[],
): IProfilesConfig => ({
  items: items.map((item, index) => ({
    uid: `uid-${index}`,
    name: `Profile ${index}`,
    type: "remote",
    file: `file-${index}`,
    ...item,
  })) as IProfileItem[],
  current: items[0]?.uid,
});

describe("ProfilePage", () => {
  beforeEach(() => {
    mutateProfilesMock.mockReset();
    mutateLogsMock.mockReset();
    mutateMock.mockReset();
    showNoticeMock.mockReset();
    importProfileMock.mockReset().mockResolvedValue(undefined);
    patchProfilesMock.mockReset().mockResolvedValue(true);
    enhanceProfilesMock.mockReset().mockResolvedValue(undefined);
    deleteProfileMock.mockReset().mockResolvedValue(undefined);
    reorderProfileMock.mockReset().mockResolvedValue(undefined);
    createProfileMock.mockReset().mockResolvedValue(undefined);
    getProfilesMock.mockReset().mockResolvedValue(makeProfileConfig([]));
    getRuntimeLogsMock.mockReset().mockResolvedValue({});
    readTextMock.mockReset().mockResolvedValue("https://clipboard.example.com");
    readTextFileMock.mockReset().mockResolvedValue("profile-data");
    closeAllConnectionsMock.mockReset();
    profileItemRenderMock.mockClear();
    profileViewerEditMock.mockReset();
    listenMock.mockReset();
    addListenerMock.mockReset();
    eventOnceMock.mockReset();
    baseSearchBoxController.reset();
    baseStyledSelectController.reset();
    dndContextProps = null;
    useProfilesState = {
      profiles: makeProfileConfig([
        { uid: "uid-0", name: "Main", url: "https://one.example.com" },
        { uid: "uid-1", name: "Backup", url: "https://two.example.com" },
      ]),
      mutateProfiles: mutateProfilesMock,
    };
    useLocationValue = { state: undefined };
  });

  it("imports profile via button and shows success notice", async () => {
    const user = userEvent.setup({ delay: null });

    const refreshedConfig = makeProfileConfig([
      { uid: "uid-0", name: "Main", url: "https://one.example.com" },
      { uid: "uid-1", name: "Backup", url: "https://two.example.com" },
      { uid: "uid-2", name: "Imported", url: "https://import.example.com" },
    ]);
    getProfilesMock.mockResolvedValue(refreshedConfig);

    render(<ProfilePage />);

    const input = screen.getByTestId(
      "profile-url-input-field",
    ) as HTMLInputElement;
    await user.type(input, "https://import.example.com");

    const importButton = screen.getByRole("button", { name: "Import" });
    await user.click(importButton);

    expect(importProfileMock).toHaveBeenCalledWith(
      "https://import.example.com",
    );

    await waitFor(() => {
      expect(showNoticeMock).toHaveBeenCalledWith(
        "success",
        "Profile Imported Successfully",
      );
    });
  });

  it("shows error notice for invalid URL", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ProfilePage />);

    const input = screen.getByTestId(
      "profile-url-input-field",
    ) as HTMLInputElement;
    await user.type(input, "invalid-url");
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(showNoticeMock).toHaveBeenCalledWith("error", "Invalid Profile URL");
    expect(importProfileMock).not.toHaveBeenCalled();
  });

  it("supports batch selection and deletion of profiles", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ProfilePage />);

    const batchButton = screen.getByTitle("Batch Operations");
    await user.click(batchButton);

    await user.click(screen.getByTestId("select-uid-0"));
    await user.click(screen.getByTestId("select-uid-1"));

    const deleteSelected = screen.getByTitle("Delete Selected Profiles");
    await user.click(deleteSelected);

    expect(deleteProfileMock).toHaveBeenCalledTimes(2);
    expect(deleteProfileMock).toHaveBeenNthCalledWith(1, "uid-0");
    expect(deleteProfileMock).toHaveBeenNthCalledWith(2, "uid-1");
  });

  it("reorders profiles via drag and updates order", async () => {
    render(<ProfilePage />);

    expect(dndContextProps?.onDragEnd).toBeTruthy();

    await act(async () => {
      await dndContextProps!.onDragEnd?.({
        active: { id: "uid-0" },
        over: { id: "uid-1" },
      });
    });

    expect(reorderProfileMock).toHaveBeenCalledWith("uid-0", "uid-1");
    expect(mutateProfilesMock).toHaveBeenCalled();
  });
});
