import "@testing-library/jest-dom/vitest";
import { TextDecoder, TextEncoder } from "node:util";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (!globalThis.TextEncoder) {
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}

if (!globalThis.TextDecoder) {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserver {
    callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      // no-op: jsdom does not do layout, this stub prevents crashes
    }

    unobserve() {
      // no-op
    }

    disconnect() {
      // no-op
    }
  }

  // @ts-expect-error: jsdom typings do not include the stub
  window.ResizeObserver = ResizeObserver;
}

afterEach(() => {
  cleanup();
});

const suppressedPrefix = "[TrafficErrorBoundary]";
const suppressedIncludes = [
  "Error: boom",
  "Error: fail",
  "The above error occurred in the <ProblemChild>",
  "The above error occurred in the <ThrowingComponent>",
];
(["error", "log", "warn"] as const).forEach((method) => {
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    const first = args[0];
    if (first instanceof Error) {
      if (first.message === "boom" || first.message === "fail") {
        return;
      }
    }
    if (
      typeof args[0] === "string" &&
      ((args[0] as string).startsWith(suppressedPrefix) ||
        suppressedIncludes.some((token) => (args[0] as string).includes(token)))
    ) {
      return;
    }
    original.apply(console, args as [unknown, ...unknown[]]);
  };
});
