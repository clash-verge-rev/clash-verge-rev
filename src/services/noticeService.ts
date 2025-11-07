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

function notifyListeners() {
  const snapshot = notices.slice();
  for (const listener of listeners) {
    listener(snapshot);
  }
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
  let idx = -1;
  for (let i = 0; i < notices.length; i++) {
    if (notices[i].id === id) {
      idx = i;
      const timer = notices[i].timerId;
      if (timer) {
        clearTimeout(timer); // Clear timeout if manually closed
      }
      break;
    }
  }
  if (idx !== -1) {
    notices = [...notices.slice(0, idx), ...notices.slice(idx + 1)];
  }
  notifyListeners();
}

// Subscribes a listener function to notice state changes.

export function subscribeNotices(listener: Listener) {
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
  for (const n of notices) {
    if (n.timerId) clearTimeout(n.timerId);
  }
  notices = [];
  notifyListeners();
}
