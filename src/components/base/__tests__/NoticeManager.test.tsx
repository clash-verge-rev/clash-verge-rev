import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Notice = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
};

const noticesState: {
  items: Notice[];
  subscriber?: (items: Notice[]) => void;
} = {
  items: [],
};

vi.mock("@/services/noticeService", () => {
  return {
    subscribeNotices: (listener: (items: Notice[]) => void) => {
      noticesState.subscriber = listener;
      return () => {
        noticesState.subscriber = undefined;
      };
    },
    getSnapshotNotices: () => noticesState.items,
    hideNotice: vi.fn((id: number) => {
      noticesState.items = noticesState.items.filter(
        (notice) => notice.id !== id,
      );
      noticesState.subscriber?.(noticesState.items);
    }),
    __setNotices: (items: Notice[]) => {
      noticesState.items = items;
    },
    __notify: () => {
      noticesState.subscriber?.(noticesState.items);
    },
  };
});

const noticeServiceModule = (await import(
  "@/services/noticeService"
)) as typeof import("@/services/noticeService") & {
  __setNotices: (items: Notice[]) => void;
  __notify: () => void;
  hideNotice: ReturnType<typeof vi.fn>;
};

const NoticeManagerModule = await import("@/components/base/NoticeManager");
const { NoticeManager } = NoticeManagerModule;
const { __setNotices, __notify, hideNotice } = noticeServiceModule;

describe("NoticeManager", () => {
  beforeEach(() => {
    __setNotices([]);
    hideNotice.mockClear();
  });

  it("renders notices provided by the store", () => {
    __setNotices([
      { id: 1, type: "success", message: "Saved" },
      { id: 2, type: "error", message: "Failed" },
    ]);

    render(<NoticeManager />);
    __notify();

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("calls hideNotice when close button is clicked", async () => {
    const user = userEvent.setup();
    __setNotices([{ id: 3, type: "info", message: "Heads up" }]);

    render(<NoticeManager />);
    __notify();

    const closeButton = screen.getByRole("button");
    await user.click(closeButton);

    expect(hideNotice).toHaveBeenCalledWith(3);
  });
});
