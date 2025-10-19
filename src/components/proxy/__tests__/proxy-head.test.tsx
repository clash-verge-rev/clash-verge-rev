import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ProxyHead } from "@/components/proxy/proxy-head";
import type { HeadState } from "@/components/proxy/use-head-state";
import { useVerge } from "@/hooks/use-verge";

const { setUrlMock } = vi.hoisted(() => ({
  setUrlMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: vi.fn(),
}));

vi.mock("@/services/delay", () => ({
  default: {
    setUrl: setUrlMock,
  },
}));

const useVergeMock = vi.mocked(useVerge);

const baseHeadState: HeadState = {
  open: false,
  showType: true,
  sortType: 0,
  filterText: "",
  textState: null,
  testUrl: "",
};

const renderProxyHead = (override: Partial<HeadState> = {}) => {
  const props = {
    sx: undefined,
    url: undefined,
    groupName: "TestGroup",
    headState: { ...baseHeadState, ...override },
    onHeadState: vi.fn(),
    onLocation: vi.fn(),
    onCheckDelay: vi.fn(),
  };

  const result = render(<ProxyHead {...props} />);
  return { ...props, ...result };
};

describe("ProxyHead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVergeMock.mockReturnValue({
      verge: { default_latency_test: "https://default.url" },
    } as ReturnType<typeof useVerge>);
  });

  it("sets the delay manager url with trimmed custom url", async () => {
    renderProxyHead({ testUrl: "  https://custom.test  " });

    await waitFor(() =>
      expect(setUrlMock).toHaveBeenCalledWith(
        "TestGroup",
        "https://custom.test",
      ),
    );
  });

  it("cycles sort type when the sort button is clicked", () => {
    const { onHeadState } = renderProxyHead({ sortType: 0 });

    fireEvent.click(screen.getByTitle("Sort by default"));

    expect(onHeadState).toHaveBeenCalledWith({ sortType: 1 });
  });

  it("renders filter input when filter mode is active and forwards updates", () => {
    const { onHeadState } = renderProxyHead({
      textState: "filter",
      filterText: "abc",
    });

    const input = screen.getByPlaceholderText("Filter conditions");
    fireEvent.change(input, { target: { value: "beta" } });

    expect(onHeadState).toHaveBeenCalledWith({ filterText: "beta" });
  });

  it("opens url mode before triggering delay check with custom url", () => {
    const { onHeadState, onCheckDelay } = renderProxyHead({
      testUrl: "https://custom",
      textState: null,
    });

    fireEvent.click(screen.getByTitle("Delay check"));

    expect(onHeadState).toHaveBeenCalledWith({ textState: "url" });
    expect(onCheckDelay).toHaveBeenCalledTimes(1);
  });

  it("invokes onLocation when locate button is clicked", () => {
    const { onLocation } = renderProxyHead();

    fireEvent.click(screen.getByTitle("locate"));

    expect(onLocation).toHaveBeenCalledTimes(1);
  });
});
