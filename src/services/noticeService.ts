import { ReactNode } from "react";

interface NoticeItem {
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

function flushListeners() {
  listeners.forEach((listener) => listener([...notices])); // Pass a copy
}

let notifyScheduled = false;
function scheduleNotify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  requestAnimationFrame(() => {
    notifyScheduled = false;
    flushListeners();
  });
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
  scheduleNotify();
  return id;
}

// Hides a specific notification by its ID.

export function hideNotice(id: number) {
  const notice = notices.find((n) => n.id === id);
  if (notice?.timerId) {
    clearTimeout(notice.timerId); // Clear timeout if manually closed
  }
  notices = notices.filter((n) => n.id !== id);
  scheduleNotify();
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
  scheduleNotify();
}
