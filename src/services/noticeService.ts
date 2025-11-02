import { ReactNode } from "react";

type NoticeType = "success" | "error" | "info";

/**
 * Descriptor used when the notice content should be resolved through i18n.
 */
export interface NoticeTranslationDescriptor {
  i18nKey: string;
  params?: Record<string, unknown>;
  fallback?: string;
}

/**
 * Notification payload that either renders raw React content or defers to i18n.
 */
type NoticeMessage = ReactNode | NoticeTranslationDescriptor;

interface NoticeItem {
  readonly id: number;
  readonly type: NoticeType;
  readonly duration: number;
  readonly message?: ReactNode;
  readonly i18n?: NoticeTranslationDescriptor;
  timerId?: ReturnType<typeof setTimeout>;
}

type NoticeShortcut = (message: NoticeMessage, duration?: number) => number;

type ShowNotice = ((
  type: NoticeType,
  message: NoticeMessage,
  duration?: number,
) => number) & {
  success: NoticeShortcut;
  error: NoticeShortcut;
  info: NoticeShortcut;
};

type NoticeSubscriber = () => void;

const DEFAULT_DURATIONS: Readonly<Record<NoticeType, number>> = {
  success: 3000,
  info: 5000,
  error: 8000,
};

let nextId = 0;
let notices: NoticeItem[] = [];
const subscribers: Set<NoticeSubscriber> = new Set();

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber());
}

function resolveDuration(type: NoticeType, override?: number) {
  return override ?? DEFAULT_DURATIONS[type];
}

function buildNotice(
  id: number,
  type: NoticeType,
  message: NoticeMessage,
  duration: number,
  timerId?: ReturnType<typeof setTimeout>,
): NoticeItem {
  if (isTranslationDescriptor(message)) {
    return {
      id,
      type,
      duration,
      timerId,
      i18n: message,
    };
  }

  return {
    id,
    type,
    duration,
    timerId,
    message,
  };
}

/**
 * Imperative entry point for users to display new notices.
 */
const baseShowNotice = (
  type: NoticeType,
  message: NoticeMessage,
  duration?: number,
): number => {
  const id = nextId++;
  const effectiveDuration = resolveDuration(type, duration);
  const timerId =
    effectiveDuration > 0
      ? setTimeout(() => hideNotice(id), effectiveDuration)
      : undefined;
  const notice = buildNotice(id, type, message, effectiveDuration, timerId);

  notices = [...notices, notice];
  notifySubscribers();
  return id;
};

export const showNotice: ShowNotice = Object.assign(baseShowNotice, {
  success: (message: NoticeMessage, duration?: number) =>
    baseShowNotice("success", message, duration),
  error: (message: NoticeMessage, duration?: number) =>
    baseShowNotice("error", message, duration),
  info: (message: NoticeMessage, duration?: number) =>
    baseShowNotice("info", message, duration),
});

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

export function hideNotice(id: number) {
  const notice = notices.find((candidate) => candidate.id === id);
  if (notice?.timerId) {
    clearTimeout(notice.timerId);
  }
  notices = notices.filter((candidate) => candidate.id !== id);
  notifySubscribers();
}

export function subscribeNotices(subscriber: NoticeSubscriber) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function getSnapshotNotices() {
  return notices;
}

export function clearAllNotices() {
  notices.forEach((notice) => {
    if (notice.timerId) clearTimeout(notice.timerId);
  });
  notices = [];
  notifySubscribers();
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
