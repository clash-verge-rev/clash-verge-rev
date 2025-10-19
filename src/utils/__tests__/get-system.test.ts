import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import getSystem from "@/utils/get-system";

describe("getSystem", () => {
  let userAgentGetter: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    userAgentGetter = vi.spyOn(window.navigator, "userAgent", "get");
  });

  afterEach(() => {
    userAgentGetter.mockRestore();
    vi.unstubAllGlobals();
  });

  it("prefers macOS when the user agent reports mac", () => {
    userAgentGetter.mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0_0)",
    );
    vi.stubGlobal("OS_PLATFORM", "linux");

    expect(getSystem()).toBe("macos");
  });

  it("falls back to OS_PLATFORM when user agent is inconclusive", () => {
    userAgentGetter.mockReturnValue("GenericAgent/1.0");
    vi.stubGlobal("OS_PLATFORM", "win32");

    expect(getSystem()).toBe("windows");
  });

  it("detects linux from the user agent string", () => {
    userAgentGetter.mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    vi.stubGlobal("OS_PLATFORM", "android");

    expect(getSystem()).toBe("linux");
  });

  it("returns unknown when nothing matches", () => {
    userAgentGetter.mockReturnValue("CustomAgent/1.0");
    vi.stubGlobal("OS_PLATFORM", "android");

    expect(getSystem()).toBe("unknown");
  });
});
