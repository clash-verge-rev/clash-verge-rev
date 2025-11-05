#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const localesDir = path.join(repoRoot, "src", "locales");
const baselineFile = path.join(localesDir, "en.json");

const bannedNamespaces = [
  "common",
  "profiles",
  "settings",
  "proxies",
  "rules",
  "home",
  "connections",
  "logs",
  "theme",
  "unlock",
  "validation",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareStructure(base, target, segments = []) {
  const errors = [];
  const baseKeys = Object.keys(base ?? {}).sort();
  const targetKeys = Object.keys(target ?? {}).sort();

  const missing = baseKeys.filter((key) => !targetKeys.includes(key));
  const extra = targetKeys.filter((key) => !baseKeys.includes(key));

  if (missing.length > 0) {
    errors.push(
      `Missing keys at ${segments.join(".") || "<root>"}: ${missing.join(", ")}`,
    );
  }
  if (extra.length > 0) {
    errors.push(
      `Unexpected keys at ${segments.join(".") || "<root>"}: ${extra.join(", ")}`,
    );
  }

  for (const key of baseKeys) {
    if (!targetKeys.includes(key)) continue;
    const nextSegments = [...segments, key];
    const baseValue = base[key];
    const targetValue = target[key];

    if (isRecord(baseValue) !== isRecord(targetValue)) {
      errors.push(
        `Type mismatch at ${nextSegments.join(".")}: expected ${
          isRecord(baseValue) ? "object" : "string"
        }`,
      );
      continue;
    }

    if (isRecord(baseValue) && isRecord(targetValue)) {
      errors.push(...compareStructure(baseValue, targetValue, nextSegments));
    }
  }

  return errors;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function validateLocaleParity() {
  const baseline = readJson(baselineFile);
  const localeFiles = readdirSync(localesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(localesDir, file));

  const issues = [];

  for (const localeFile of localeFiles) {
    if (localeFile === baselineFile) continue;
    const localeData = readJson(localeFile);
    const diff = compareStructure(baseline, localeData);
    if (diff.length) {
      issues.push(
        `Locale ${path.basename(localeFile)}:\n  ${diff.join("\n  ")}`,
      );
    }
  }

  return issues;
}

async function validateCodePrefixes() {
  const files = await glob("src/**/*.{ts,tsx,js,jsx,mts,cts}", {
    cwd: repoRoot,
    nodir: true,
    ignore: ["src/locales/**"],
  });

  const violations = [];

  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = readFileSync(absolutePath, "utf8");

    for (const ns of bannedNamespaces) {
      const pattern = new RegExp(`["'\`]${ns}\\.`, "g");
      if (pattern.test(content)) {
        violations.push(
          `${relativePath}: forbidden namespace "${ns}." detected`,
        );
      }
    }
  }

  return violations;
}

async function main() {
  const issues = validateLocaleParity();
  const prefixViolations = await validateCodePrefixes();
  const allProblems = [...issues, ...prefixViolations];

  if (allProblems.length > 0) {
    console.error("i18n structure validation failed:\n");
    for (const problem of allProblems) {
      console.error(`- ${problem}`);
    }
    console.error(
      "\nRun `pnpm format:i18n` or update locale files to match the baseline.",
    );
    process.exit(1);
  }

  console.log("i18n structure validation passed.");
}

main().catch((error) => {
  console.error("Unexpected error while validating i18n structure:");
  console.error(error);
  process.exit(1);
});
