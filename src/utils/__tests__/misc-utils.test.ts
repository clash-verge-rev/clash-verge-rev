import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import debounce from "@/utils/debounce";
import { isValidUrl } from "@/utils/helper";
import ignoreCase from "@/utils/ignore-case";
import isAsyncFunction from "@/utils/is-async-function";
import { truncateStr } from "@/utils/truncate-str";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delays execution until the wait period elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("preserves call context and forwards arguments", () => {
    const context = { value: 42 };
    const fn = vi.fn(function (this: typeof context, arg: string) {
      expect(this).toBe(context);
      expect(arg).toBe("payload");
    });

    const debounced = debounce(fn, 50);
    debounced.call(context, "payload");

    vi.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("ignoreCase", () => {
  it("lowercases keys and deep-copies values", () => {
    const source = {
      Foo: { nested: 1 },
      Bar: ["a", "b"],
    };

    const result = ignoreCase(source);

    expect(result).toHaveProperty("foo");
    expect(result).toHaveProperty("bar");
    expect(result.foo).toEqual(source.Foo);
    expect(result.bar).toEqual(source.Bar);
    expect(result.foo).not.toBe(source.Foo);
    expect(result.bar).not.toBe(source.Bar);
  });

  it("returns an empty object when provided a falsy value", () => {
    expect(ignoreCase(null as unknown as Record<string, unknown>)).toEqual({});
  });
});

describe("truncateStr", () => {
  it("returns the original value when shorter than the limit", () => {
    expect(truncateStr("short string")).toBe("short string");
  });

  it("truncates long strings while keeping prefix and suffix", () => {
    const longValue = "abcdefghijklmnopqrstuvwxyz0123456789".repeat(2);
    const result = truncateStr(longValue);

    expect(result).toContain(" ... ");
    expect(result?.startsWith(longValue.slice(0, 16))).toBe(true);
    expect(result?.endsWith(longValue.slice(-35))).toBe(true);
    expect(result?.length).toBeLessThanOrEqual(56);
  });
});

describe("isValidUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flags well-formed URLs as valid", () => {
    expect(isValidUrl("https://example.com/path")).toBe(true);
  });

  it("logs and rejects invalid URLs", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(isValidUrl("not a url")).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});

describe("isAsyncFunction", () => {
  it("detects async functions", () => {
    expect(isAsyncFunction(async () => "ok")).toBe(true);
  });

  it("rejects regular functions", () => {
    expect(isAsyncFunction(() => "ok")).toBe(false);
  });
});
