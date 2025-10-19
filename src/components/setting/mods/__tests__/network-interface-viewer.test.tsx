import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { useEffect, useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const swrMock = vi.fn();
const writeTextMock = vi.fn();
const showNoticeMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@mui/material", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mui-box">{children}</div>
  );
  const Button = ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
  const IconButton = ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} data-testid="icon-button">
      {children}
    </button>
  );

  return {
    alpha: (color: string) => color,
    Box,
    Button,
    IconButton,
  };
});

vi.mock("@mui/icons-material", () => ({
  ContentCopyRounded: (props: Record<string, unknown>) => (
    <svg data-testid="copy-icon" {...props} />
  ),
}));

vi.mock("swr", () => ({
  default: (...args: unknown[]) => swrMock(...args),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeTextMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => showNoticeMock(...args),
}));

vi.mock("@/components/base", () => ({
  BaseDialog: ({
    open,
    title,
    children,
    cancelBtn,
    onCancel,
  }: {
    open: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    cancelBtn?: React.ReactNode;
    onCancel?: () => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="network-dialog">
        <div data-testid="network-dialog-title">{title}</div>
        <div data-testid="network-dialog-content">{children}</div>
        {cancelBtn && (
          <button type="button" onClick={onCancel}>
            {cancelBtn}
          </button>
        )}
      </div>
    );
  },
  DialogRef: {} as any,
}));

vi.mock("@/services/cmds", () => ({
  getNetworkInterfacesInfo: vi.fn(),
}));

let NetworkInterfaceViewer: (typeof import("../network-interface-viewer"))["NetworkInterfaceViewer"];

beforeAll(async () => {
  ({ NetworkInterfaceViewer } = await import("../network-interface-viewer"));
});

const networkData = [
  {
    name: "eth0",
    mac_addr: "AA:BB:CC:DD",
    addr: [{ V4: { ip: "192.168.1.100" } }, { V6: { ip: "fe80::abcd" } }],
  },
  {
    name: "wifi0",
    mac_addr: "11:22:33:44",
    addr: [{ V4: { ip: "10.0.0.2" } }],
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  swrMock.mockReturnValue({ data: networkData });
  writeTextMock.mockResolvedValue(undefined);
  showNoticeMock.mockReset();
});

type DialogHandle = { open: () => void; close: () => void };

const openViewer = async () => {
  const Host = ({ onReady }: { onReady: (handle: DialogHandle) => void }) => {
    const ref = useRef<DialogHandle | null>(null);
    useEffect(() => {
      if (ref.current) {
        onReady(ref.current);
      }
    }, [onReady]);

    return <NetworkInterfaceViewer ref={ref} />;
  };

  let handle: DialogHandle | null = null;
  render(<Host onReady={(next) => (handle = next)} />);
  await waitFor(() => expect(handle).not.toBeNull());
  await act(async () => {
    handle?.open();
  });
  await waitFor(() =>
    expect(screen.getByTestId("network-dialog")).toBeVisible(),
  );
};

describe("NetworkInterfaceViewer", () => {
  it("opens via ref and renders IPv4 data by default", async () => {
    await openViewer();

    expect(swrMock).toHaveBeenCalledWith(
      "clash-verge-rev-internal://network-interfaces",
      expect.any(Function),
      expect.objectContaining({ fallbackData: [] }),
    );

    const ethSection = screen.getByText("eth0").closest("div");
    expect(ethSection).toBeInTheDocument();
    expect(
      within(ethSection as HTMLElement).getByText("192.168.1.100"),
    ).toBeInTheDocument();
    expect(
      within(ethSection as HTMLElement).getByText("AA:BB:CC:DD"),
    ).toBeInTheDocument();

    const wifiSection = screen.getByText("wifi0").closest("div");
    expect(wifiSection).toBeInTheDocument();
    expect(
      within(wifiSection as HTMLElement).getByText("10.0.0.2"),
    ).toBeInTheDocument();
  });

  it("toggles between IPv4 and IPv6 records", async () => {
    await openViewer();
    const toggleButton = screen.getByRole("button", { name: "Ipv6" });
    await userEvent.click(toggleButton);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ipv4" })).toBeInTheDocument(),
    );

    const ethSection = screen.getByText("eth0").closest("div") as HTMLElement;
    expect(within(ethSection).getByText("fe80::abcd")).toBeInTheDocument();
    expect(within(ethSection).getByText("AA:BB:CC:DD")).toBeInTheDocument();
    expect(
      within(ethSection).queryByText("192.168.1.100"),
    ).not.toBeInTheDocument();
  });

  it("copies address content to clipboard with success notice", async () => {
    await openViewer();
    const copyButton = screen.getAllByTestId("icon-button")[0];

    await userEvent.click(copyButton);

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("192.168.1.100"),
    );
    expect(showNoticeMock).toHaveBeenCalledWith("success", "Copy Success");
  });
});
