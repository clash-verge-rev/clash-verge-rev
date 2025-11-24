import { useEffect } from "react";
import type { Key } from "swr";

type SharedPollerEntry = {
  subscribers: number;
  timer: number | null;
  interval: number;
  callback: (() => void) | null;
  refreshWhenHidden: boolean;
  refreshWhenOffline: boolean;
};

const sharedPollers = new Map<string, SharedPollerEntry>();

const isDocumentHidden = () => {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
};

const isOffline = () => {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
};

const ensureTimer = (key: string, entry: SharedPollerEntry) => {
  if (typeof window === "undefined") return;

  if (entry.timer !== null) {
    clearInterval(entry.timer);
  }

  entry.timer = window.setInterval(() => {
    if (!entry.refreshWhenHidden && isDocumentHidden()) return;
    if (!entry.refreshWhenOffline && isOffline()) return;
    entry.callback?.();
  }, entry.interval);
};

const registerSharedPoller = (
  key: string,
  interval: number,
  callback: () => void,
  options: { refreshWhenHidden: boolean; refreshWhenOffline: boolean },
) => {
  let entry = sharedPollers.get(key);

  if (!entry) {
    entry = {
      subscribers: 0,
      timer: null,
      interval,
      callback,
      refreshWhenHidden: options.refreshWhenHidden,
      refreshWhenOffline: options.refreshWhenOffline,
    };
    sharedPollers.set(key, entry);
  }

  entry.subscribers += 1;
  entry.callback = callback;
  entry.interval = Math.min(entry.interval, interval);
  entry.refreshWhenHidden =
    entry.refreshWhenHidden || options.refreshWhenHidden;
  entry.refreshWhenOffline =
    entry.refreshWhenOffline || options.refreshWhenOffline;

  ensureTimer(key, entry);

  return () => {
    const current = sharedPollers.get(key);
    if (!current) return;

    current.subscribers -= 1;
    if (current.subscribers <= 0) {
      if (current.timer !== null) {
        clearInterval(current.timer);
      }
      sharedPollers.delete(key);
    }
  };
};

const normalizeKey = (key: Key): string | null => {
  if (typeof key === "string") return key;
  if (typeof key === "number" || typeof key === "boolean") return String(key);
  if (Array.isArray(key)) {
    try {
      return JSON.stringify(key);
    } catch {
      return null;
    }
  }
  return null;
};

export interface SharedSWRPollerOptions {
  refreshWhenHidden?: boolean;
  refreshWhenOffline?: boolean;
}

export const useSharedSWRPoller = (
  key: Key,
  interval?: number,
  callback?: () => void,
  options?: SharedSWRPollerOptions,
) => {
  const refreshWhenHidden = options?.refreshWhenHidden ?? false;
  const refreshWhenOffline = options?.refreshWhenOffline ?? false;

  useEffect(() => {
    if (!key || !interval || interval <= 0 || !callback) return;

    const serializedKey = normalizeKey(key);
    if (!serializedKey) return;

    return registerSharedPoller(serializedKey, interval, callback, {
      refreshWhenHidden,
      refreshWhenOffline,
    });
  }, [key, interval, callback, refreshWhenHidden, refreshWhenOffline]);
};
