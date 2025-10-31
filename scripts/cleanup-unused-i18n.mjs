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

function printUsage() {
  console.log(`Usage: pnpm node scripts/cleanup-unused-i18n.mjs [options]

Options:
  --apply            Write locale files with unused keys removed (default: report only)
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
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--apply":
        options.apply = true;
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

function processLocale(locale, allSourceContent, options) {
  const raw = fs.readFileSync(locale.path, "utf8");
  const data = JSON.parse(raw);
  const flattened = flattenLocale(data);

  const unused = [];
  for (const key of flattened.keys()) {
    if (!isKeyUsed(allSourceContent, key)) {
      unused.push(key);
    }
  }

  if (unused.length === 0) {
    console.log(`[${locale.name}] No unused keys 🎉`);
    return {
      locale: locale.name,
      file: locale.path,
      totalKeys: flattened.size,
      unusedKeys: [],
      removed: [],
    };
  }

  console.log(
    `[${locale.name}] Found ${unused.length} unused keys (of ${flattened.size}):`,
  );
  for (const key of unused) {
    console.log(`  - ${key}`);
  }

  const removed = [];
  if (options.apply) {
    const updated = JSON.parse(JSON.stringify(data));
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
      `[${locale.name}] Updated locale file saved (${removed.length} keys removed)`,
    );
  }

  return {
    locale: locale.name,
    file: locale.path,
    totalKeys: flattened.size,
    unusedKeys: unused,
    removed,
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

  console.log(`\nChecking ${locales.length} locale files...\n`);

  const results = locales.map((locale) =>
    processLocale(locale, allSourceContent, options),
  );

  const totalUnused = results.reduce(
    (count, result) => count + result.unusedKeys.length,
    0,
  );

  console.log("\nSummary:");
  for (const result of results) {
    console.log(
      `  • ${result.locale}: ${result.unusedKeys.length} unused / ${result.totalKeys} total`,
    );
  }
  console.log(`\nTotal unused keys: ${totalUnused}`);
  if (options.apply) {
    console.log(
      "Files were updated in-place; review diffs before committing changes.",
    );
  } else {
    console.log(
      "Run with --apply to write cleaned locale files. Backups will be created unless --no-backup is passed.",
    );
  }

  if (options.reportPath) {
    const payload = {
      generatedAt: new Date().toISOString(),
      options: {
        apply: options.apply,
        backup: options.backup,
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
