import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  SystemMonitorValidator,
  systemMonitorValidator,
  withDataValidation,
} from "@/utils/data-validator";

const createValidOverview = (): ISystemMonitorOverview => ({
  traffic: {
    raw: {
      up: 1024,
      down: 2048,
      up_rate: 512,
      down_rate: 256,
    },
    formatted: {
      up_rate: "1KB/s",
      down_rate: "512B/s",
      total_up: "10MB",
      total_down: "20MB",
    },
    is_fresh: true,
  },
  memory: {
    raw: {
      inuse: 4096,
      oslimit: 8192,
      usage_percent: 42,
    },
    formatted: {
      inuse: "4GB",
      oslimit: "8GB",
      usage_percent: 42,
    },
    is_fresh: false,
  },
  overall_status: "active",
});

describe("SystemMonitorValidator", () => {
  let validator: SystemMonitorValidator;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    validator = new SystemMonitorValidator();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("validates well-formed system monitor data", () => {
    const data = createValidOverview();
    expect(validator.validate(data)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads and reports the validation issue", () => {
    const malformed = {
      traffic: {
        raw: {
          up: "oops",
          down: 0,
          up_rate: 0,
          down_rate: 0,
        },
        formatted: {
          up_rate: "",
          down_rate: "",
          total_up: "",
          total_down: "",
        },
        is_fresh: "yes",
      },
      memory: {},
      overall_status: "offline",
    };

    expect(validator.validate(malformed)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("sanitizes malformed data back into a safe structure", () => {
    const sanitized = validator.sanitize({
      traffic: {
        raw: { up: "bad", down: null, up_rate: undefined, down_rate: NaN },
        formatted: {
          up_rate: "",
          down_rate: null,
          total_up: "",
          total_down: undefined,
        },
        is_fresh: null,
      },
      memory: {
        raw: { inuse: NaN, oslimit: "??", usage_percent: Infinity },
        formatted: {
          inuse: "",
          oslimit: null,
          usage_percent: NaN,
        },
        is_fresh: undefined,
      },
      overall_status: "totally-unknown",
    });

    expect(sanitized).toEqual({
      traffic: {
        raw: { up: 0, down: 0, up_rate: 0, down_rate: 0 },
        formatted: {
          up_rate: "0B",
          down_rate: "0B",
          total_up: "0B",
          total_down: "0B",
        },
        is_fresh: false,
      },
      memory: {
        raw: { inuse: 0, oslimit: 0, usage_percent: 0 },
        formatted: {
          inuse: "0B",
          oslimit: "0B",
          usage_percent: 0,
        },
        is_fresh: false,
      },
      overall_status: "unknown",
    });
  });

  it("keeps valid payloads untouched when sanitizing", () => {
    const data = createValidOverview();
    expect(validator.sanitize(data)).toEqual(data);
  });
});

describe("withDataValidation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the original API result when validation passes", async () => {
    const validator = {
      validate: vi.fn().mockReturnValue(true),
      sanitize: vi.fn(),
    };
    const apiCall = vi.fn().mockResolvedValue("payload");
    const wrapped = withDataValidation(apiCall, validator);

    const result = await wrapped("arg1", "arg2");

    expect(apiCall).toHaveBeenCalledWith("arg1", "arg2");
    expect(validator.validate).toHaveBeenCalledWith("payload");
    expect(validator.sanitize).not.toHaveBeenCalled();
    expect(result).toBe("payload");
  });

  it("sanitizes invalid payloads", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sanitized = createValidOverview();
    const validator = {
      validate: vi.fn().mockReturnValue(false),
      sanitize: vi.fn().mockReturnValue(sanitized),
    };
    const apiCall = vi.fn().mockResolvedValue("bad");
    const wrapped = withDataValidation(apiCall, validator);

    const result = await wrapped();

    expect(validator.validate).toHaveBeenCalledWith("bad");
    expect(validator.sanitize).toHaveBeenCalledWith("bad");
    expect(warnSpy).toHaveBeenCalledWith(
      "[DataValidator] API返回数据验证失败，尝试修复:",
      "bad",
    );
    expect(result).toBe(sanitized);
  });

  it("falls back to sanitized defaults when the API call throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sanitized = systemMonitorValidator.sanitize(null);
    const validator = {
      validate: vi.fn(),
      sanitize: vi.fn().mockReturnValue(sanitized),
    };
    const apiCall = vi.fn().mockRejectedValue(new Error("network down"));
    const wrapped = withDataValidation(apiCall, validator);

    await expect(wrapped()).resolves.toEqual(sanitized);
    expect(validator.validate).not.toHaveBeenCalled();
    expect(validator.sanitize).toHaveBeenCalledWith(null);
    expect(errorSpy).toHaveBeenCalled();
  });
});
