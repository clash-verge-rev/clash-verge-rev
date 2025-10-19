import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProxyItem } from "@/components/proxy/proxy-item";

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

type ProxyGroup = { name: string };

type ProxyItemData = {
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
  overrides: Partial<ProxyItemData> = {},
): ProxyItemData => ({
  name: "ProxyA",
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

const group: ProxyGroup = { name: "GroupA" };

describe("ProxyItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVergeMock.mockReturnValue({
      verge: { default_latency_timeout: 8000 },
    });
    formatDelayColorMock.mockReturnValue("success.main");
  });

  it("registers and removes delay listeners for non-preset proxies", async () => {
    getDelayUpdateMock.mockReturnValue({ delay: 120, updatedAt: Date.now() });
    formatDelayMock.mockReturnValue("120");

    const { unmount } = render(
      <ProxyItem
        group={group as any}
        proxy={createProxy() as any}
        selected={false}
      />,
    );

    await screen.findByText("120");

    expect(setListenerMock).toHaveBeenCalledWith(
      "ProxyA",
      "GroupA",
      expect.any(Function),
    );

    unmount();

    expect(removeListenerMock).toHaveBeenCalledWith("ProxyA", "GroupA");
  });

  it("invokes onClick with proxy name when list item is clicked", () => {
    getDelayUpdateMock.mockReturnValue({ delay: -1, updatedAt: 0 });
    formatDelayMock.mockReturnValue("-");
    const onClick = vi.fn();

    render(
      <ProxyItem
        group={group as any}
        proxy={createProxy() as any}
        selected={false}
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledWith("ProxyA");
  });

  it("runs delay check when delay badge is clicked", async () => {
    getDelayUpdateMock.mockReturnValue({ delay: 200, updatedAt: Date.now() });
    formatDelayMock.mockReturnValue("200");
    checkDelayMock.mockResolvedValue({ delay: 250, updatedAt: Date.now() });

    render(
      <ProxyItem
        group={group as any}
        proxy={createProxy() as any}
        selected={false}
      />,
    );

    const delayBadge = await screen.findByText("200");
    fireEvent.click(delayBadge);

    await waitFor(() => {
      expect(checkDelayMock).toHaveBeenCalledWith("ProxyA", "GroupA", 8000);
    });
  });
});
