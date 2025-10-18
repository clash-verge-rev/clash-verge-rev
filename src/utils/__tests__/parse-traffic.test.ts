import { describe, expect, it } from "vitest";

import parseTraffic from "@/utils/parse-traffic";

describe("parseTraffic", () => {
  it("returns NaN tuple when input is not numeric", () => {
    expect(parseTraffic(undefined)).toEqual(["NaN", ""]);
    expect(parseTraffic("foo" as unknown as number)).toEqual(["NaN", ""]);
  });

  it("formats sub-kilobyte values using bytes", () => {
    expect(parseTraffic(0)).toEqual(["0", "B"]);
    expect(parseTraffic(512)).toEqual(["512", "B"]);
    expect(parseTraffic(999.4)).toEqual(["999", "B"]);
  });

  it("selects the correct unit across large magnitudes", () => {
    const kb = parseTraffic(2048);
    expect(kb[1]).toBe("KB");
    expect(Number(kb[0])).toBeCloseTo(2, 3);

    const mb = parseTraffic(10 * 1024 * 1024);
    expect(mb[1]).toBe("MB");
    expect(Number(mb[0])).toBeCloseTo(10, 1);

    const gb = parseTraffic(1.5 * 1024 ** 3);
    expect(gb[1]).toBe("GB");
    expect(Number(gb[0])).toBeCloseTo(1.5, 1);

    const yb = parseTraffic(1024 ** 8 * 1.23);
    expect(yb[1]).toBe("YB");
    expect(Number(yb[0])).toBeCloseTo(1.23, 2);
  });
});
