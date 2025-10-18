import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IpInfoCard } from "@/components/home/ip-info-card";

const { getIpInfoMock } = vi.hoisted(() => ({
  getIpInfoMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/home/enhanced-card", () => ({
  EnhancedCard: ({
    title,
    action,
    children,
  }: {
    title: ReactNode;
    action: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="enhanced-card">
      <div data-testid="card-title">{title}</div>
      <div data-testid="card-action">{action}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/services/api", () => ({
  getIpInfo: getIpInfoMock,
}));

const createIpInfo = () => ({
  ip: "123.45.67.89",
  country: "Wonderland",
  country_code: "WL",
  asn: 65432,
  isp: "Imagination Net",
  asn_organization: "Wonder Labs",
  city: "Dream City",
  region: "Fantasy Province",
  timezone: "UTC+1",
  longitude: 12.3456,
  latitude: 65.4321,
});

const disableAutoRefreshTimers = () => {
  const intervalSpy = vi
    .spyOn(window, "setInterval")
    .mockImplementation(
      () => 0 as unknown as ReturnType<typeof window.setInterval>,
    );
  const clearIntervalSpy = vi
    .spyOn(window, "clearInterval")
    .mockImplementation(() => undefined);

  return () => {
    intervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  };
};

describe("IpInfoCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getIpInfoMock.mockReset();
  });

  it("shows loading skeleton then renders fetched IP information", async () => {
    const ipInfo = createIpInfo();
    getIpInfoMock.mockResolvedValue(ipInfo);
    const restoreInterval = disableAutoRefreshTimers();

    try {
      render(<IpInfoCard />);

      expect(screen.queryByText("Wonderland")).toBeNull();

      await waitFor(() => {
        expect(screen.getByText("Wonderland")).toBeInTheDocument();
      });

      expect(screen.getByText("AS65432")).toBeInTheDocument();
      expect(screen.queryByText(ipInfo.ip)).not.toBeInTheDocument();
      expect(getIpInfoMock).toHaveBeenCalled();
    } finally {
      restoreInterval();
    }
  });

  it("toggles IP visibility", async () => {
    const ipInfo = createIpInfo();
    getIpInfoMock.mockResolvedValue(ipInfo);

    render(<IpInfoCard />);

    await screen.findByText("Wonderland");

    expect(screen.queryByText(ipInfo.ip)).not.toBeInTheDocument();

    const showButton = screen
      .getByTestId("VisibilityOutlinedIcon")
      .closest("button");
    expect(showButton).not.toBeNull();
    fireEvent.click(showButton!);

    await waitFor(() =>
      expect(screen.getByText(ipInfo.ip)).toBeInTheDocument(),
    );

    const hideButton = screen
      .getByTestId("VisibilityOffOutlinedIcon")
      .closest("button");
    expect(hideButton).not.toBeNull();
    fireEvent.click(hideButton!);

    expect(screen.queryByText(ipInfo.ip)).not.toBeInTheDocument();
  });

  it("renders error state and retries successfully", async () => {
    const ipInfo = createIpInfo();
    getIpInfoMock.mockRejectedValue(new Error("network failed"));
    const restoreInterval = disableAutoRefreshTimers();

    try {
      render(<IpInfoCard />);

      await screen.findByText("network failed");
      const initialCalls = getIpInfoMock.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      getIpInfoMock.mockResolvedValue(ipInfo);

      const retryButton = screen.getByRole("button", { name: /Retry/i });
      fireEvent.click(retryButton);

      await screen.findByText("Wonderland");
      expect(getIpInfoMock.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      restoreInterval();
    }
  });
});
