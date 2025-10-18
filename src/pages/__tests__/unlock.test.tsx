import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";

const invokeMock = vi.fn();
const showNoticeMock = vi.fn();

type UnlockItem = {
  name: string;
  status: string;
  region?: string | null;
  check_time?: string | null;
};

const baseItems = [
  { name: "Netflix", status: "Pending", region: null, check_time: null },
  {
    name: "YouTube",
    status: "Unlocked",
    region: "US",
    check_time: "2025-10-17",
  },
];

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: [string, string]) => showNoticeMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args),
}));

const UnlockPageModule = await import("@/pages/unlock");
const UnlockPage = UnlockPageModule.default;

describe("UnlockPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    showNoticeMock.mockReset();
    localStorage.clear();
  });

  it("loads cached unlock items and merges with defaults on mount", async () => {
    const cachedItems = [
      {
        name: "Netflix",
        status: "Unlocked",
        region: "JP",
        check_time: "cached",
      },
      { name: "Disney+", status: "Failed", region: null, check_time: "cached" },
    ];
    localStorage.setItem(
      "clash_verge_unlock_results",
      JSON.stringify(cachedItems),
    );
    localStorage.setItem("clash_verge_unlock_time", "cached-time");

    invokeMock.mockResolvedValueOnce(baseItems);

    render(<UnlockPage />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_unlock_items");
    });

    expect(await screen.findByText("Netflix")).toBeInTheDocument();
    expect(await screen.findByText("YouTube")).toBeInTheDocument();
    expect(await screen.findByText("Disney+")).toBeInTheDocument();

    expect(localStorage.getItem("clash_verge_unlock_results")).toContain(
      '"name":"Disney+"',
    );
  });

  it("checks all unlock items and updates storage", async () => {
    invokeMock.mockResolvedValueOnce(baseItems); // initial load
    invokeMock.mockResolvedValueOnce([
      {
        name: "Netflix",
        status: "Unlocked",
        region: "CA",
        check_time: "2025-10-18",
      },
      {
        name: "YouTube",
        status: "Failed",
        region: null,
        check_time: "2025-10-18",
      },
    ]);

    const user = userEvent.setup();
    render(<UnlockPage />);

    await screen.findByText("Netflix");

    const checkAllButton = await screen.findByRole("button", {
      name: "Test All",
    });
    await user.click(checkAllButton);

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(
          ([command]) => command === "check_media_unlock",
        ),
      ).toBe(true);
    });

    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem("clash_verge_unlock_results") ?? "[]",
      ) as UnlockItem[];
      expect(saved.some((item) => item.region === "CA")).toBe(true);
    });
  });

  it("handles single item re-check and errors gracefully", async () => {
    invokeMock.mockResolvedValueOnce(baseItems); // initial load
    invokeMock.mockResolvedValueOnce(baseItems); // first re-check

    const user = userEvent.setup();
    render(<UnlockPage />);

    const netflixCard = (await screen.findByText("Netflix")).closest("div")!;
    const cardButton = within(netflixCard).getByRole("button");
    await user.click(cardButton);

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(
          ([command]) => command === "check_media_unlock",
        ),
      ).toBe(true);
    });

    invokeMock.mockRejectedValueOnce(new Error("timeout"));
    await user.click(cardButton);

    await waitFor(() => {
      expect(showNoticeMock).toHaveBeenCalledWith("error", "timeout");
    });
  });

  it("shows an empty state when there are no unlock items", async () => {
    invokeMock.mockResolvedValueOnce([]);

    render(<UnlockPage />);

    expect(await screen.findByTestId("base-empty")).toBeInTheDocument();
  });

  it("disables controls while running the full unlock check", async () => {
    const deferred = createDeferred<UnlockItem[]>();
    invokeMock.mockResolvedValueOnce(baseItems);
    invokeMock.mockImplementationOnce(() => deferred.promise);

    const user = userEvent.setup();
    render(<UnlockPage />);

    const netflixCard = (await screen.findByText("Netflix")).closest("div")!;
    const singleButton = within(netflixCard).getByRole("button");
    const checkAllButton = await screen.findByRole("button", {
      name: "Test All",
    });

    await user.click(checkAllButton);

    expect(checkAllButton).toBeDisabled();
    expect(checkAllButton).toHaveTextContent("Testing...");
    expect(singleButton).toBeDisabled();

    deferred.resolve([
      { name: "Netflix", status: "Unlocked", region: "CA", check_time: "done" },
      { name: "YouTube", status: "Failed", region: null, check_time: "done" },
    ]);

    await waitFor(() => {
      expect(checkAllButton).not.toBeDisabled();
    });
    expect(checkAllButton).toHaveTextContent("Test All");
    expect(singleButton).not.toBeDisabled();
  });

  it("updates single item results and clears loading state after success", async () => {
    const deferred = createDeferred<UnlockItem[]>();
    invokeMock.mockResolvedValueOnce(baseItems);
    invokeMock.mockImplementationOnce(() => deferred.promise);

    const user = userEvent.setup();
    render(<UnlockPage />);

    const netflixCard = (await screen.findByText("Netflix")).closest("div")!;
    const cardButton = within(netflixCard).getByRole("button");

    await user.click(cardButton);
    expect(cardButton).toBeDisabled();

    deferred.resolve([
      {
        name: "Netflix",
        status: "Unlocked",
        region: "CA",
        check_time: "2025-10-18",
      },
      {
        name: "YouTube",
        status: "Unlocked",
        region: "US",
        check_time: "2025-10-17",
      },
    ]);

    await waitFor(() => {
      expect(cardButton).not.toBeDisabled();
    });
    expect(screen.getByText("CA")).toBeInTheDocument();

    const stored = JSON.parse(
      localStorage.getItem("clash_verge_unlock_results") ?? "[]",
    ) as UnlockItem[];
    expect(stored.find((item) => item.name === "Netflix")?.region).toBe("CA");
  });
});
