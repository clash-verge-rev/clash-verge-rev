import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHotkey } from "@/utils/parse-hotkey";

describe("parseHotkey", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("normalises printable characters that require shift modifiers", () => {
    expect(parseHotkey("!")).toBe("DIGIT1");
    expect(parseHotkey("+")).toBe("EQUAL");
    expect(parseHotkey("_")).toBe("MINUS");
  });

  it("keeps basic alpha keys uppercase when no mapping exists", () => {
    expect(parseHotkey("a")).toBe("A");
    expect(parseHotkey("z")).toBe("Z");
  });

  it("maps built-in key codes to meaningful tokens", () => {
    expect(parseHotkey("Digit5")).toBe("Digit5");
    expect(parseHotkey("ArrowDown")).toBe("DOWN");
    expect(parseHotkey("/")).toBe("Slash");
  });

  it("aliases modifier keys to consistent labels", () => {
    expect(parseHotkey("Control")).toBe("CTRL");
    expect(parseHotkey("Meta")).toBe("CMD");
  });

  it("handles special cases like space correctly", () => {
    expect(parseHotkey(" ")).toBe("SPACE");
  });
});
