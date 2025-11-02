import { ReactNode } from "react";

type NoticeType = "success" | "error" | "info";

export interface NoticeTranslationDescriptor {
  i18nKey: string;
  params?: Record<string, unknown>;
  fallback?: string;
}

type NoticeMessage = ReactNode | NoticeTranslationDescriptor;

interface NoticeItem {
  id: number;
  type: NoticeType;
  message?: ReactNode;
  i18n?: NoticeTranslationDescriptor;
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

function isTranslationDescriptor(
  message: NoticeMessage,
): message is NoticeTranslationDescriptor {
  if (
    typeof message === "object" &&
    message !== null &&
    Object.prototype.hasOwnProperty.call(message, "i18nKey")
  ) {
    const descriptor = message as NoticeTranslationDescriptor;
    return typeof descriptor.i18nKey === "string";
  }
  return false;
}

// Shows a notification.

export function showNotice(
  type: NoticeType,
  message: NoticeMessage,
  duration?: number,
): number {
  const id = nextId++;
  const effectiveDuration =
    duration ?? (type === "error" ? 8000 : type === "info" ? 5000 : 3000); // Longer defaults

  const newNotice: NoticeItem = {
    id,
    type,
    duration: effectiveDuration,
  };

  if (isTranslationDescriptor(message)) {
    newNotice.i18n = message;
  } else {
    newNotice.message = message;
  }

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

export function showTranslatedNotice(
  type: NoticeType,
  i18nKey: string,
  options?: {
    params?: Record<string, unknown>;
    fallback?: string;
  },
  duration?: number,
) {
  return showNotice(
    type,
    {
      i18nKey,
      params: options?.params,
      fallback: options?.fallback,
    },
    duration,
  );
}

export const createRawNotice = (
  message: string,
  fallback?: string,
): NoticeTranslationDescriptor => ({
  i18nKey: "common.notices.raw",
  params: { message },
  fallback: fallback ?? message,
});

export const createPrefixedNotice = (
  prefix: string,
  message: string,
  fallback?: string,
): NoticeTranslationDescriptor => ({
  i18nKey: "common.notices.prefixedRaw",
  params: { prefix, message },
  fallback: fallback ?? `${prefix} ${message}`,
});

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
