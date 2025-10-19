import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProxyItemMini } from "@/components/proxy/proxy-item-mini";

const {
  setListenerMock,
  removeListenerMock,
  getDelayUpdateMock,
  getDelayFixMock,
  checkDelayMock,
  formatDelayMock,
  formatDelayColorMock,
  useVergeMock,
} = vi.hoisted(() => {
  const setListener = vi.fn();
  const removeListener = vi.fn();
  const getDelayUpdate = vi.fn();
  const getDelayFix = vi.fn();
  const checkDelay = vi.fn();
  const formatDelay = vi.fn();
  const formatDelayColor = vi.fn();
  const vergeMock = vi.fn();

  return {
    setListenerMock: setListener,
    removeListenerMock: removeListener,
    getDelayUpdateMock: getDelayUpdate,
    getDelayFixMock: getDelayFix,
    checkDelayMock: checkDelay,
    formatDelayMock: formatDelay,
    formatDelayColorMock: formatDelayColor,
    useVergeMock: vergeMock,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("ahooks", () => ({
  useLockFn: (fn: (...args: unknown[]) => Promise<unknown> | unknown) => fn,
}));

vi.mock("@/components/base", () => ({
  BaseLoading: () => <div data-testid="base-loading" />,
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => useVergeMock(),
}));

vi.mock("@/services/delay", () => ({
  __esModule: true,
  default: {
    setListener: (...args: unknown[]) => setListenerMock(...args),
    removeListener: (...args: unknown[]) => removeListenerMock(...args),
    getDelayUpdate: (...args: unknown[]) => getDelayUpdateMock(...args),
    getDelayFix: (...args: unknown[]) => getDelayFixMock(...args),
    checkDelay: (...args: unknown[]) => checkDelayMock(...args),
    formatDelay: (...args: unknown[]) => formatDelayMock(...args),
    formatDelayColor: (...args: unknown[]) => formatDelayColorMock(...args),
  },
}));

type ProxyMiniGroup = {
  name: string;
  fixed?: string | null;
  now?: string;
  type?: string;
};

type ProxyMiniItem = {
  name: string;
  history?: Array<{ time: string }>;
  provider?: string | null;
  type?: string;
  now?: string;
  udp?: boolean;
  xudp?: boolean;
  tfo?: boolean;
  mptcp?: boolean;
  smux?: boolean;
};

const createProxy = (
  overrides: Partial<ProxyMiniItem> = {},
): ProxyMiniItem => ({
  name: "ProxyMini",
  history: [],
  type: "Selector",
  provider: undefined,
  now: undefined,
  udp: false,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  ...overrides,
});

const baseGroup: ProxyMiniGroup = { name: "MiniGroup" };

describe("ProxyItemMini", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVergeMock.mockReturnValue({
      verge: { default_latency_timeout: 6000 },
    });
    formatDelayColorMock.mockReturnValue("success.main");
  });

  it("subscribes to delay updates when mounted and cleans up on unmount", async () => {
    getDelayUpdateMock.mockReturnValue({ delay: 180, updatedAt: Date.now() });
    formatDelayMock.mockReturnValue("180");

    const { unmount } = render(
      <ProxyItemMini
        group={baseGroup as any}
        proxy={createProxy() as any}
        selected={false}
      />,
    );

    await screen.findByText("180");

    expect(setListenerMock).toHaveBeenCalledWith(
      "ProxyMini",
      "MiniGroup",
      expect.any(Function),
    );

    unmount();

    expect(removeListenerMock).toHaveBeenCalledWith("ProxyMini", "MiniGroup");
  });

  it("invokes supplied onClick handler with proxy name", () => {
    getDelayUpdateMock.mockReturnValue({ delay: -1, updatedAt: 0 });
    formatDelayMock.mockReturnValue("-");
    const onClick = vi.fn();

    render(
      <ProxyItemMini
        group={baseGroup as any}
        proxy={createProxy() as any}
        selected={false}
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledWith("ProxyMini");
  });

  it("triggers delay check interaction when badge clicked and renders pin when fixed", async () => {
    getDelayUpdateMock.mockReturnValue({ delay: 90, updatedAt: Date.now() });
    formatDelayMock.mockReturnValue("90");
    checkDelayMock.mockResolvedValue({ delay: 120, updatedAt: Date.now() });

    render(
      <ProxyItemMini
        group={
          {
            ...baseGroup,
            fixed: "ProxyMini",
            now: "ProxyMini",
            type: "URLTest",
          } as any
        }
        proxy={createProxy() as any}
        selected
      />,
    );

    const delayBadge = await screen.findByText("90");
    fireEvent.click(delayBadge);

    await waitFor(() => {
      expect(checkDelayMock).toHaveBeenCalledWith(
        "ProxyMini",
        "MiniGroup",
        6000,
      );
    });

    const pin = screen.getByText("📌");
    expect(pin).toHaveAttribute("title", "Delay check to cancel fixed");
  });
});
