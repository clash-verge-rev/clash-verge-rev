import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllNotices,
  getSnapshotNotices,
  hideNotice,
  showNotice,
  subscribeNotices,
} from "@/services/noticeService";

describe("noticeService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllNotices();
  });

  it("showNotice registers notice with default duration based on type", () => {
    const successId = showNotice("success", "Saved");
    const errorId = showNotice("error", "Failed");
    const infoId = showNotice("info", "Heads up");

    const notices = getSnapshotNotices();
    const success = notices.find((n) => n.id === successId);
    const error = notices.find((n) => n.id === errorId);
    const info = notices.find((n) => n.id === infoId);

    expect(success?.duration).toBe(3000);
    expect(error?.duration).toBe(8000);
    expect(info?.duration).toBe(5000);
  });

  it("auto hides notices after configured duration", () => {
    showNotice("info", "Auto hide soon", 1000);

    expect(getSnapshotNotices()).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    expect(getSnapshotNotices()).toHaveLength(0);
  });

  it("manual hide clears timer and removes notice", () => {
    const id = showNotice("error", "Close me", 5000);
    expect(getSnapshotNotices()).toHaveLength(1);

    hideNotice(id);

    expect(getSnapshotNotices()).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(getSnapshotNotices()).toHaveLength(0);
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNotices(listener);

    const id = showNotice("info", "First");
    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id, message: "First" }),
      ]),
    );

    listener.mockClear();
    unsubscribe();

    showNotice("info", "Second");
    expect(listener).not.toHaveBeenCalled();
  });

  afterEach(() => {
    clearAllNotices();
    vi.useRealTimers();
  });
});
