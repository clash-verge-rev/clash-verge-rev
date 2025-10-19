/* eslint-disable @eslint-react/no-create-ref */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProfileViewer,
  type ProfileViewerRef,
} from "@/components/profile/profile-viewer";

const mocks = vi.hoisted(() => {
  const useProfilesMock = vi.fn();
  const createProfileMock = vi.fn();
  const patchProfileMock = vi.fn();
  const showNoticeMock = vi.fn();

  return {
    useProfilesMock,
    createProfileMock,
    patchProfileMock,
    showNoticeMock,
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

vi.mock("@/components/base", async () => {
  const React = await import("react");

  const BaseDialog = ({
    open,
    title,
    children,
    okBtn,
    cancelBtn,
    onOk,
    onCancel,
    loading,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    okBtn: string;
    cancelBtn: string;
    onOk?: () => void;
    onCancel?: () => void;
    loading?: boolean;
  }) =>
    open ? (
      <div data-testid="profile-viewer-dialog">
        <h2>{title}</h2>
        <div>{children}</div>
        <button type="button" onClick={onCancel}>
          {cancelBtn}
        </button>
        <button
          type="button"
          onClick={onOk}
          disabled={loading}
          aria-label={okBtn}
        >
          {okBtn}
        </button>
      </div>
    ) : null;

  const Switch = React.forwardRef<
    HTMLInputElement,
    {
      checked?: boolean;
      onChange?: (value: unknown) => void;
      onBlur?: () => void;
      name?: string;
    }
  >(({ checked, onChange, onBlur, name }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      role="checkbox"
      name={name}
      checked={Boolean(checked)}
      onChange={(event) => onChange?.(event.target.checked)}
      onBlur={onBlur}
      data-testid={name}
    />
  ));
  Switch.displayName = "SwitchMock";

  return { BaseDialog, Switch };
});

vi.mock("@/components/profile/file-input", () => ({
  FileInput: ({
    onChange,
  }: {
    onChange: (file: File, content: string) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-file-input"
      onClick={() =>
        onChange(
          new File(["dummy"], "local.yaml", { type: "text/yaml" }),
          "file-data",
        )
      }
    >
      upload
    </button>
  ),
}));

vi.mock("@/hooks/use-profiles", () => ({
  useProfiles: () => mocks.useProfilesMock(),
}));

vi.mock("@/services/cmds", () => ({
  createProfile: (...args: unknown[]) => mocks.createProfileMock(...args),
  patchProfile: (...args: unknown[]) => mocks.patchProfileMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => mocks.showNoticeMock(...args),
}));

describe("ProfileViewer", () => {
  const {
    useProfilesMock,
    createProfileMock,
    patchProfileMock,
    showNoticeMock,
  } = mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    useProfilesMock.mockReturnValue({ profiles: {} });
  });

  const openViewer = async () => {
    const onChange = vi.fn();
    const ref = createRef<ProfileViewerRef>();
    render(<ProfileViewer ref={ref} onChange={onChange} />);
    ref.current?.create();
    await screen.findByRole("button", { name: "Save" });
    return { ref, onChange };
  };

  const getSwitchInput = (label: string) => {
    const labelNode = screen.getByText(label);
    const container = labelNode.closest("div") ?? labelNode.parentElement;
    const input = container?.querySelector('input[type="checkbox"]') as
      | HTMLInputElement
      | undefined;
    if (!input) {
      throw new Error(`Switch for ${label} not found`);
    }
    return input;
  };

  it("creates a remote profile and notifies parent on success", async () => {
    const onChange = vi.fn();
    const ref = createRef<ProfileViewerRef>();
    createProfileMock.mockResolvedValue(undefined);

    render(<ProfileViewer ref={ref} onChange={onChange} />);
    ref.current?.create();

    const user = userEvent.setup();

    const urlField = await screen.findByLabelText("Subscription URL");
    await user.type(urlField, "https://example.com/sub.yaml");

    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "Remote Profile");

    const saveButton = await screen.findByRole("button", { name: "Save" });
    await user.click(saveButton);

    await waitFor(() => expect(createProfileMock).toHaveBeenCalledTimes(1));
    const [payload, fileContent] = createProfileMock.mock.calls[0] as [
      any,
      any,
    ];
    expect(payload).toMatchObject({
      type: "remote",
      url: "https://example.com/sub.yaml",
      name: "Remote Profile",
      option: {
        with_proxy: false,
        self_proxy: false,
      },
    });
    expect(fileContent).toBeNull();

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
  });

  it("retries remote update via clash proxy when initial patch fails", async () => {
    useProfilesMock.mockReturnValue({ profiles: { current: "profile-1" } });
    const onChange = vi.fn();
    const ref = createRef<ProfileViewerRef>();

    const existingProfile = {
      uid: "profile-1",
      type: "remote",
      name: "Existing",
      desc: "",
      url: "https://example.com/profile.yaml",
      option: {
        with_proxy: false,
        self_proxy: false,
      },
    } as IProfileItem;

    createProfileMock.mockReset();
    patchProfileMock.mockRejectedValueOnce(new Error("boom"));
    patchProfileMock.mockResolvedValueOnce(undefined);
    patchProfileMock.mockResolvedValueOnce(undefined);

    render(<ProfileViewer ref={ref} onChange={onChange} />);
    ref.current?.edit(existingProfile);

    const user = userEvent.setup();
    const saveButton = await screen.findByRole("button", { name: "Save" });
    await user.click(saveButton);

    await waitFor(() => expect(patchProfileMock).toHaveBeenCalledTimes(3));

    const [firstUid, firstPayload] = patchProfileMock.mock.calls[0] as [
      string,
      any,
    ];
    expect(firstUid).toBe("profile-1");
    expect(firstPayload).toMatchObject({
      type: "remote",
      url: "https://example.com/profile.yaml",
    });

    const secondCall = patchProfileMock.mock.calls[1] as [string, any];
    expect(secondCall[0]).toBe("profile-1");
    expect(secondCall[1]).toMatchObject({
      option: {
        with_proxy: false,
        self_proxy: true,
      },
    });

    const thirdCall = patchProfileMock.mock.calls[2] as [string, any];
    expect(thirdCall[0]).toBe("profile-1");
    expect(thirdCall[1]).toEqual({
      option: {
        with_proxy: false,
        self_proxy: false,
      },
    });

    expect(showNoticeMock).toHaveBeenCalledWith(
      "info",
      "Profile creation failed, retrying with Clash proxy...",
    );
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      "Profile creation succeeded with Clash proxy",
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  });

  it("keeps system proxy and clash proxy switches mutually exclusive", async () => {
    const { onChange } = await openViewer();
    const user = userEvent.setup();

    const systemProxySwitch = getSwitchInput("Use System Proxy");
    const clashProxySwitch = getSwitchInput("Use Clash Proxy");

    expect(systemProxySwitch.checked).toBe(false);
    expect(clashProxySwitch.checked).toBe(false);

    await user.click(systemProxySwitch);
    expect(systemProxySwitch.checked).toBe(true);
    expect(clashProxySwitch.checked).toBe(false);

    await user.click(clashProxySwitch);
    expect(clashProxySwitch.checked).toBe(true);
    await waitFor(() => expect(systemProxySwitch.checked).toBe(false));

    await user.click(systemProxySwitch);
    expect(systemProxySwitch.checked).toBe(true);
    await waitFor(() => expect(clashProxySwitch.checked).toBe(false));

    expect(onChange).not.toHaveBeenCalled();
  });
});
