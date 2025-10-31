#!/usr/bin/env node

import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SOURCE_DIRS = [
  path.resolve(__dirname, "../src"),
  path.resolve(__dirname, "../src-tauri"),
];
const LOCALES_DIR = path.resolve(__dirname, "../src/locales");
const DEFAULT_BASELINE_LANG = "en";
const IGNORE_DIR_NAMES = new Set([
  ".git",
  ".idea",
  ".turbo",
  ".next",
  ".cache",
  ".pnpm",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  "gen",
  "packages",
  "release",
  "logs",
  "__pycache__",
]);
const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".rs",
  ".json",
]);

const WHITELIST_KEYS = new Set([
  "theme.light",
  "theme.dark",
  "theme.system",
  "Already Using Latest Core Version",
]);

const MAX_PREVIEW_ENTRIES = 40;

function printUsage() {
  console.log(`Usage: pnpm node scripts/cleanup-unused-i18n.mjs [options]

Options:
  --apply            Write locale files with unused keys removed (default: report only)
  --align            Align locale structure/order using the baseline locale
  --baseline <lang>  Baseline locale file name (default: ${DEFAULT_BASELINE_LANG})
  --keep-extra       Preserve keys that exist only in non-baseline locales when aligning
  --no-backup        Skip creating \`.bak\` backups when applying changes
  --report <path>    Write a JSON report to the given path
  --src <path>       Include an additional source directory (repeatable)
  --help             Show this message
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    backup: true,
    reportPath: null,
    extraSources: [],
    align: false,
    baseline: DEFAULT_BASELINE_LANG,
    keepExtra: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--align":
        options.align = true;
        break;
      case "--keep-extra":
        options.keepExtra = true;
        break;
      case "--no-backup":
        options.backup = false;
        break;
      case "--report": {
        const next = argv[i + 1];
        if (!next) {
          throw new Error("--report requires a file path");
        }
        options.reportPath = path.resolve(process.cwd(), next);
        i += 1;
        break;
      }
      case "--baseline": {
        const next = argv[i + 1];
        if (!next) {
          throw new Error("--baseline requires a locale name (e.g. en)");
        }
        options.baseline = next.replace(/\.json$/, "");
        i += 1;
        break;
      }
      case "--src":
      case "--source": {
        const next = argv[i + 1];
        if (!next) {
          throw new Error(`${arg} requires a directory path`);
        }
        options.extraSources.push(path.resolve(process.cwd(), next));
        i += 1;
        break;
      }
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return options;
}

function getAllFiles(start, predicate) {
  if (!fs.existsSync(start)) return [];

  const stack = [start];
  const files = [];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (IGNORE_DIR_NAMES.has(entry.name)) {
          continue;
        }
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else if (!predicate || predicate(entryPath)) {
          files.push(entryPath);
        }
      }
    } else if (!predicate || predicate(current)) {
      files.push(current);
    }
  }

  return files;
}

function loadSourceContents(sourceDirs) {
  const sourceFiles = sourceDirs.flatMap((dir) =>
    getAllFiles(dir, (filePath) =>
      SUPPORTED_EXTENSIONS.has(path.extname(filePath)),
    ),
  );

  return sourceFiles
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
}

function flattenLocale(obj, parent = "") {
  const entries = new Map();

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return entries;
  }

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = parent ? `${parent}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const childEntries = flattenLocale(value, currentPath);
      for (const [childKey, childValue] of childEntries) {
        entries.set(childKey, childValue);
      }
    } else {
      entries.set(currentPath, value);
    }
  }

  return entries;
}

function diffLocaleKeys(baselineEntries, localeEntries) {
  const missing = [];
  const extra = [];

  for (const key of baselineEntries.keys()) {
    if (!localeEntries.has(key)) {
      missing.push(key);
    }
  }

  for (const key of localeEntries.keys()) {
    if (!baselineEntries.has(key)) {
      extra.push(key);
    }
  }

  missing.sort();
  extra.sort();

  return { missing, extra };
}

function alignToBaseline(baselineNode, localeNode, options) {
  const shouldCopyLocale =
    localeNode && typeof localeNode === "object" && !Array.isArray(localeNode);

  if (
    baselineNode &&
    typeof baselineNode === "object" &&
    !Array.isArray(baselineNode)
  ) {
    const result = {};
    const baselineKeys = Object.keys(baselineNode);
    for (const key of baselineKeys) {
      const baselineValue = baselineNode[key];
      const localeValue = shouldCopyLocale ? localeNode[key] : undefined;

      if (
        baselineValue &&
        typeof baselineValue === "object" &&
        !Array.isArray(baselineValue)
      ) {
        result[key] = alignToBaseline(
          baselineValue,
          localeValue && typeof localeValue === "object" ? localeValue : {},
          options,
        );
      } else if (localeValue === undefined) {
        result[key] = baselineValue;
      } else {
        result[key] = localeValue;
      }
    }

    if (options.keepExtra && shouldCopyLocale) {
      const extraKeys = Object.keys(localeNode)
        .filter((key) => !baselineKeys.includes(key))
        .sort();
      for (const key of extraKeys) {
        result[key] = localeNode[key];
      }
    }

    return result;
  }

  return shouldCopyLocale ? localeNode : baselineNode;
}

function logPreviewEntries(label, items) {
  if (!items || items.length === 0) return;

  const preview = items.slice(0, MAX_PREVIEW_ENTRIES);
  for (const item of preview) {
    console.log(`    · ${label}: ${item}`);
  }
  if (items.length > preview.length) {
    console.log(
      `    · ${label}: ... and ${items.length - preview.length} more`,
    );
  }
}

function removeKey(target, dottedKey) {
  const parts = dottedKey.split(".");
  const last = parts.pop();

  if (!last) return;

  let current = target;
  for (const part of parts) {
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(part in current)
    ) {
      return;
    }
    current = current[part];
  }

  if (current && typeof current === "object") {
    delete current[last];
  }
}

function cleanupEmptyBranches(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }

  for (const key of Object.keys(target)) {
    if (cleanupEmptyBranches(target[key])) {
      delete target[key];
    }
  }

  return Object.keys(target).length === 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKeyUsed(content, key) {
  if (WHITELIST_KEYS.has(key)) return true;
  if (!key) return false;

  const pattern = new RegExp(`(['"\`])${escapeRegExp(key)}\\1`);
  return pattern.test(content);
}

function writeReport(reportPath, data) {
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(reportPath, `${payload}\n`, "utf8");
}

function loadLocales() {
  if (!fs.existsSync(LOCALES_DIR)) {
    throw new Error(`Locales directory not found: ${LOCALES_DIR}`);
  }

  return fs
    .readdirSync(LOCALES_DIR)
    .filter(
      (file) =>
        /^[a-z0-9\-_]+\.json$/i.test(file) &&
        !file.endsWith(".bak") &&
        !file.endsWith(".old"),
    )
    .map((file) => ({
      name: path.basename(file, ".json"),
      path: path.join(LOCALES_DIR, file),
    }));
}

function ensureBackup(localePath) {
  const backupPath = `${localePath}.bak`;
  if (fs.existsSync(backupPath)) {
    throw new Error(
      `Backup file already exists for ${path.basename(localePath)}; ` +
        "either remove it manually or rerun with --no-backup",
    );
  }
  fs.copyFileSync(localePath, backupPath);
  return backupPath;
}

function processLocale(
  locale,
  baselineData,
  baselineEntries,
  allSourceContent,
  options,
) {
  const raw = fs.readFileSync(locale.path, "utf8");
  const data = JSON.parse(raw);
  const flattened = flattenLocale(data);
  const expectedTotal = baselineEntries.size;

  const { missing, extra } = diffLocaleKeys(baselineEntries, flattened);

  const unused = [];
  for (const key of flattened.keys()) {
    if (!isKeyUsed(allSourceContent, key)) {
      unused.push(key);
    }
  }

  if (
    unused.length === 0 &&
    missing.length === 0 &&
    extra.length === 0 &&
    !options.align
  ) {
    console.log(`[${locale.name}] No issues detected 🎉`);
  } else {
    console.log(`[${locale.name}] Check results:`);
    console.log(
      `  unused: ${unused.length}, missing vs baseline: ${missing.length}, extra: ${extra.length}`,
    );
    logPreviewEntries("unused", unused);
    logPreviewEntries("missing", missing);
    logPreviewEntries("extra", extra);
  }

  const removed = [];
  let aligned = false;
  if (options.apply) {
    let updated;
    if (options.align) {
      aligned = true;
      updated = alignToBaseline(baselineData, data, options);
    } else {
      updated = JSON.parse(JSON.stringify(data));
    }

    for (const key of unused) {
      removeKey(updated, key);
      removed.push(key);
    }
    cleanupEmptyBranches(updated);

    if (options.backup) {
      const backupPath = ensureBackup(locale.path);
      console.log(
        `[${locale.name}] Backup written to ${path.basename(backupPath)}`,
      );
    }

    const serialized = JSON.stringify(updated, null, 2);
    fs.writeFileSync(locale.path, `${serialized}\n`, "utf8");
    console.log(
      `[${locale.name}] Updated locale file saved (${removed.length} unused removed${
        aligned ? ", structure aligned" : ""
      })`,
    );
  }

  return {
    locale: locale.name,
    file: locale.path,
    totalKeys: flattened.size,
    expectedKeys: expectedTotal,
    unusedKeys: unused,
    removed,
    missingKeys: missing,
    extraKeys: extra,
    aligned: aligned && options.apply,
  };
}

function main() {
  const argv = process.argv.slice(2);

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.log();
    printUsage();
    process.exit(1);
  }

  const sourceDirs = [
    ...new Set([...DEFAULT_SOURCE_DIRS, ...options.extraSources]),
  ];

  console.log("Scanning source directories:");
  for (const dir of sourceDirs) {
    console.log(`  - ${dir}`);
  }

  const allSourceContent = loadSourceContents(sourceDirs);
  const locales = loadLocales();

  if (locales.length === 0) {
    console.log("No locale files found.");
    return;
  }

  const baselineLocale = locales.find(
    (item) => item.name.toLowerCase() === options.baseline.toLowerCase(),
  );

  if (!baselineLocale) {
    const available = locales.map((item) => item.name).join(", ");
    throw new Error(
      `Baseline locale "${options.baseline}" not found. Available locales: ${available}`,
    );
  }

  const baselineData = JSON.parse(fs.readFileSync(baselineLocale.path, "utf8"));
  const baselineEntries = flattenLocale(baselineData);

  locales.sort((a, b) => {
    if (a.name === baselineLocale.name) return -1;
    if (b.name === baselineLocale.name) return 1;
    return a.name.localeCompare(b.name);
  });

  console.log(`\nChecking ${locales.length} locale files...\n`);

  const results = locales.map((locale) =>
    processLocale(
      locale,
      baselineData,
      baselineEntries,
      allSourceContent,
      options,
    ),
  );

  const totalUnused = results.reduce(
    (count, result) => count + result.unusedKeys.length,
    0,
  );
  const totalMissing = results.reduce(
    (count, result) => count + result.missingKeys.length,
    0,
  );
  const totalExtra = results.reduce(
    (count, result) => count + result.extraKeys.length,
    0,
  );

  console.log("\nSummary:");
  for (const result of results) {
    console.log(
      `  • ${result.locale}: unused=${result.unusedKeys.length}, missing=${result.missingKeys.length}, extra=${result.extraKeys.length}, total=${result.totalKeys}, expected=${result.expectedKeys}`,
    );
  }
  console.log(
    `\nTotals → unused: ${totalUnused}, missing: ${totalMissing}, extra: ${totalExtra}`,
  );
  if (options.apply) {
    console.log(
      "Files were updated in-place; review diffs before committing changes.",
    );
  } else {
    console.log(
      "Run with --apply to write cleaned locale files. Backups will be created unless --no-backup is passed.",
    );
    if (options.align) {
      console.log(
        "Alignment was evaluated in dry-run mode; rerun with --apply to rewrite locale files.",
      );
    } else {
      console.log(
        "Pass --align to normalize locale structure/order based on the baseline locale.",
      );
    }
  }

  if (options.reportPath) {
    const payload = {
      generatedAt: new Date().toISOString(),
      options: {
        apply: options.apply,
        backup: options.backup,
        align: options.align,
        baseline: baselineLocale.name,
        keepExtra: options.keepExtra,
        sourceDirs,
      },
      results,
    };
    writeReport(options.reportPath, payload);
    console.log(`Report written to ${options.reportPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error("Failed to complete i18n cleanup draft.");
  console.error(error);
  process.exit(1);
}
