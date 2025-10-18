import type { Update } from "@tauri-apps/plugin-updater";
import { describe, expect, it } from "vitest";

import {
  compareVersions,
  ensureSemver,
  extractSemver,
  normalizeVersion,
  resolveRemoteVersion,
  splitVersion,
} from "@/services/update";
import type { VersionParts } from "@/services/update";

const makeUpdate = (data: {
  version?: string | null;
  rawJson?: Record<string, unknown> | null;
}): Update =>
  ({
    version: data.version ?? "",
    rawJson: data.rawJson ?? {},
  }) as unknown as Update;

describe("normalizeVersion", () => {
  it("strips optional v prefix and trims whitespace", () => {
    expect(normalizeVersion(" v1.2.3 ")).toBe("1.2.3");
    expect(normalizeVersion("V2.0.0-beta")).toBe("2.0.0-beta");
  });

  it("returns null for empty or non-string input", () => {
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion("   ")).toBeNull();
  });
});

describe("ensureSemver", () => {
  it("returns normalized semver when input is valid", () => {
    expect(ensureSemver("1.2.3")).toBe("1.2.3");
    expect(ensureSemver("v3.4.5-alpha.1+build.7")).toBe(
      "3.4.5-alpha.1+build.7",
    );
  });

  it("returns null for invalid versions", () => {
    expect(ensureSemver("1")).toBeNull();
    expect(ensureSemver("1.2.3.4")).toBeNull();
    expect(ensureSemver("release-candidate")).toBeNull();
  });
});

describe("extractSemver", () => {
  it("finds the first semver-like string and normalizes it", () => {
    expect(extractSemver("Release v1.2.3 (latest)")).toBe("1.2.3");
    expect(extractSemver("tag:V2.0.0-beta+exp.sha")).toBe("2.0.0-beta+exp.sha");
  });

  it("returns null when no semver-like string is present", () => {
    expect(extractSemver("no version available")).toBeNull();
  });
});

describe("splitVersion", () => {
  it("splits version into numeric main and typed prerelease parts", () => {
    const parts = splitVersion("1.2.3-alpha.4.beta") as VersionParts;
    expect(parts.main).toEqual([1, 2, 3]);
    expect(parts.pre).toEqual(["alpha", 4, "beta"]);
  });

  it("returns null when version is missing", () => {
    expect(splitVersion(null)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders versions by numeric components", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("treats release versions as newer than prereleases", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
  });

  it("resolves prerelease precedence correctly", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
  });

  it("returns null when comparison cannot be made", () => {
    expect(compareVersions(null, "1.0.0")).toBeNull();
  });
});

describe("resolveRemoteVersion", () => {
  it("prefers direct semver value on the update object", () => {
    const update = makeUpdate({ version: "v1.2.3" });
    expect(resolveRemoteVersion(update)).toBe("1.2.3");
  });

  it("falls back through rawJson fields when primary version is missing", () => {
    const update = makeUpdate({
      version: "See release notes",
      rawJson: {
        version: "v2.3.4",
        tag_name: "ignore-me",
        name: "v0.0.1",
      },
    });
    expect(resolveRemoteVersion(update)).toBe("2.3.4");
  });

  it("rescues version from tag_name or name when needed", () => {
    const update = makeUpdate({
      version: "no version here",
      rawJson: {
        tag_name: "release-v3.1.0",
        name: "build-should-not-override",
      },
    });
    expect(resolveRemoteVersion(update)).toBe("3.1.0");

    const nameOnly = makeUpdate({
      version: "invalid",
      rawJson: {
        name: "release v4.0.0-beta.1",
      },
    });
    expect(resolveRemoteVersion(nameOnly)).toBe("4.0.0-beta.1");
  });

  it("returns null when no semver-like data is present", () => {
    const update = makeUpdate({
      version: "not-a-version",
      rawJson: {
        name: "nope",
      },
    });
    expect(resolveRemoteVersion(update)).toBeNull();
  });
});
