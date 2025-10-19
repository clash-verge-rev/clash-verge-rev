import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProxyRender } from "@/components/proxy/proxy-render";
import type { HeadState } from "@/components/proxy/use-head-state";

type RenderItem = ComponentProps<typeof ProxyRender>["item"];
type GroupProxy = RenderItem["group"]["all"][number];

const {
  useVergeMock,
  useThemeModeMock,
  downloadIconCacheMock,
  convertFileSrcMock,
  proxyHeadMock,
  proxyItemMock,
  proxyItemMiniMock,
} = vi.hoisted(() => ({
  useVergeMock: vi.fn<() => unknown>(),
  useThemeModeMock: vi.fn<() => unknown>(),
  downloadIconCacheMock:
    vi.fn<(url: string, fileName: string) => Promise<string>>(),
  convertFileSrcMock: vi.fn<(path: string) => string>(),
  proxyHeadMock: vi.fn<(props: unknown) => ReactElement | null>(() => null),
  proxyItemMock: vi.fn<(props: unknown) => ReactElement | null>(() => null),
  proxyItemMiniMock: vi.fn<(props: unknown) => ReactElement | null>(() => null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/services/states", () => ({
  useThemeMode: () => useThemeModeMock(),
}));

vi.mock("@/services/cmds", () => ({
  downloadIconCache: (url: string, fileName: string) =>
    downloadIconCacheMock(url, fileName),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => convertFileSrcMock(path),
}));

vi.mock("@/components/proxy/proxy-head", () => ({
  ProxyHead: (props: unknown) => proxyHeadMock(props),
}));

vi.mock("@/components/proxy/proxy-item", () => ({
  ProxyItem: (props: unknown) => proxyItemMock(props),
}));

vi.mock("@/components/proxy/proxy-item-mini", () => ({
  ProxyItemMini: (props: unknown) => proxyItemMiniMock(props),
}));

const baseProxy: GroupProxy = {
  name: "ProxyA",
  type: "Selector",
  udp: false,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  history: [],
};

const baseGroup: RenderItem["group"] = {
  name: "Test Group",
  type: "Selector",
  udp: false,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  history: [],
  now: "ProxyA",
  all: [baseProxy],
  icon: "http://example.com/icon.png",
  testUrl: "https://delay.test",
  provider: undefined,
};

const renderProxy = (
  item: RenderItem,
  overrides?: Partial<ComponentProps<typeof ProxyRender>>,
) => {
  const defaultProps: ComponentProps<typeof ProxyRender> = {
    item,
    indent: false,
    onLocation: vi.fn(),
    onCheckAll: vi.fn(),
    onHeadState: vi.fn(),
    onChangeProxy: vi.fn(),
    isChainMode: false,
  };

  return render(<ProxyRender {...defaultProps} {...overrides} />);
};

describe("ProxyRender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVergeMock.mockReturnValue({ verge: { enable_group_icon: true } });
    useThemeModeMock.mockReturnValue("dark");
    downloadIconCacheMock.mockResolvedValue("/tmp/icon.png");
    convertFileSrcMock.mockReturnValue("tauri://icon");
    proxyHeadMock.mockImplementation(() => <div data-testid="proxy-head" />);
    proxyItemMock.mockImplementation((props: any) => (
      <button data-testid="proxy-item" onClick={() => props.onClick?.()}>
        {props.proxy?.name}
      </button>
    ));
    proxyItemMiniMock.mockImplementation((props: any) => (
      <button
        data-testid={`proxy-item-mini-${props.proxy?.name}`}
        onClick={() => props.onClick?.()}
      >
        {props.proxy?.name}
      </button>
    ));
  });

  it("renders group header for type 0 and toggles open state on click", async () => {
    const onHeadState = vi.fn();

    renderProxy(
      {
        type: 0,
        key: "header-Test Group",
        group: baseGroup,
        headState: { open: true } as HeadState,
      },
      { onHeadState },
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onHeadState).toHaveBeenCalledWith("Test Group", { open: false });

    await waitFor(() => {
      expect(downloadIconCacheMock).toHaveBeenCalledWith(
        "http://example.com/icon.png",
        "TestGroup-icon.png",
      );
      expect(convertFileSrcMock).toHaveBeenCalledWith("/tmp/icon.png");
    });
  });

  it("renders ProxyHead for type 1 with expected props", () => {
    renderProxy({
      type: 1,
      key: "head-Test Group",
      group: { ...baseGroup, testUrl: "https://example.com" },
      headState: {
        open: true,
        showType: true,
        sortType: 0,
        filterText: "",
        textState: null,
        testUrl: "",
      },
    });

    expect(screen.getByTestId("proxy-head")).toBeInTheDocument();
    const props = proxyHeadMock.mock.calls.at(-1)?.[0] as any;
    expect(props.groupName).toBe("Test Group");
  });

  it("passes through to ProxyItem for type 2 and triggers onChangeProxy", () => {
    const onChangeProxy = vi.fn();

    renderProxy(
      {
        type: 2,
        key: "item-ProxyA",
        group: baseGroup,
        proxy: baseProxy,
      },
      { onChangeProxy },
    );

    fireEvent.click(screen.getByTestId("proxy-item"));

    expect(onChangeProxy).toHaveBeenCalledWith(baseGroup, baseProxy);
  });

  it("shows empty state for type 3", () => {
    renderProxy({
      type: 3,
      key: "empty-Test Group",
      group: baseGroup,
    });

    expect(screen.getByText("No Proxies")).toBeInTheDocument();
  });

  it("renders grid of mini proxy items for type 4", () => {
    renderProxy({
      type: 4,
      key: "grid-Test Group",
      group: baseGroup,
      proxyCol: [baseProxy, { ...baseProxy, name: "ProxyB" }],
      col: 2,
      headState: { showType: true } as HeadState,
    });

    expect(screen.getByTestId("proxy-item-mini-ProxyA")).toBeInTheDocument();
    expect(screen.getByTestId("proxy-item-mini-ProxyB")).toBeInTheDocument();
  });
});
