import { ReactNode } from "react";

export interface NoticeItem {
  id: number;
  type: "success" | "error" | "info";
  message: ReactNode;
  duration: number;
  timerId?: ReturnType<typeof setTimeout>;
}

type Listener = (notices: NoticeItem[]) => void;

let nextId = 0;
let notices: NoticeItem[] = [];
const listeners: Set<Listener> = new Set();

function notifyListeners() {
  listeners.forEach((listener) => listener([...notices])); // Pass a copy
}

// Shows a notification.

export function showNotice(
  type: "success" | "error" | "info",
  message: ReactNode,
  duration?: number,
): number {
  const id = nextId++;
  const effectiveDuration =
    duration ?? (type === "error" ? 8000 : type === "info" ? 5000 : 3000); // Longer defaults

  const newNotice: NoticeItem = {
    id,
    type,
    message,
    duration: effectiveDuration,
  };

  // Auto-hide timer (only if duration is not null/0)
  if (effectiveDuration > 0) {
    newNotice.timerId = setTimeout(() => {
      hideNotice(id);
    }, effectiveDuration);
  }

  notices = [...notices, newNotice];
  notifyListeners();
  return id;
}

// Hides a specific notification by its ID.

export function hideNotice(id: number) {
  const notice = notices.find((n) => n.id === id);
  if (notice?.timerId) {
    clearTimeout(notice.timerId); // Clear timeout if manually closed
  }
  notices = notices.filter((n) => n.id !== id);
  notifyListeners();
}

// Subscribes a listener function to notice state changes.

export function subscribeNotices(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSnapshotNotices() {
  return notices;
}

// Function to clear all notices at once
export function clearAllNotices() {
  notices.forEach((n) => {
    if (n.timerId) clearTimeout(n.timerId);
  });
  notices = [];
  notifyListeners();
}
