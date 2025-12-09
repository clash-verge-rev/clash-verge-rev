#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.resolve(__dirname, "../src/locales");
const TAURI_LOCALES_DIR = path.resolve(__dirname, "../src-tauri/locales");
const DEFAULT_SOURCE_DIRS = [
  path.resolve(__dirname, "../src"),
  path.resolve(__dirname, "../src-tauri"),
];
const EXCLUDE_USAGE_DIRS = [LOCALES_DIR, TAURI_LOCALES_DIR];
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
  ".json",
]);

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;
const TEMPLATE_PREFIX_PATTERN =
  /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.$/;

const IGNORED_KEY_PREFIXES = new Set([
  "text",
  "primary",
  "secondary",
  "error",
  "warning",
  "success",
  "info",
  "background",
  "grey",
  "option",
  "action",
  "example",
  "chrome",
  "localhost",
  "www",
  "pac",
  "V2",
  "v2",
  "v1",
]);

const NOTICE_METHOD_NAMES = new Set(["success", "error", "info", "warning"]);
const NOTICE_SERVICE_IDENTIFIERS = new Set([
  "@/services/notice-service",
  "./notice-service",
  "../services/notice-service",
]);

const WHITELIST_KEYS = new Set([
  "theme.light",
  "theme.dark",
  "theme.system",
  "Already Using Latest Core Version",
]);

const MAX_PREVIEW_ENTRIES = 40;
const dynamicKeyCache = new Map();
const fileUsageCache = new Map();

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

function collectSourceFiles(sourceDirs) {
  const seen = new Set();
  const files = [];

  for (const dir of sourceDirs) {
    const resolved = getAllFiles(dir, (filePath) => {
      if (seen.has(filePath)) return false;
      if (!SUPPORTED_EXTENSIONS.has(path.extname(filePath))) return false;
      if (
        EXCLUDE_USAGE_DIRS.some((excluded) =>
          filePath.startsWith(`${excluded}${path.sep}`),
        ) ||
        EXCLUDE_USAGE_DIRS.includes(filePath)
      ) {
        return false;
      }
      return true;
    });

    for (const filePath of resolved) {
      seen.add(filePath);
      files.push({
        path: filePath,
        extension: path.extname(filePath).toLowerCase(),
        content: fs.readFileSync(filePath, "utf8"),
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
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

function determineScriptKind(extension) {
  switch (extension) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function getNamespaceFromKey(key) {
  if (!key || typeof key !== "string") return null;
  const [namespace] = key.split(".");
  return namespace ?? null;
}

function addTemplatePrefixCandidate(
  prefix,
  dynamicPrefixes,
  baselineNamespaces,
) {
  if (!prefix || typeof prefix !== "string") return;
  const normalized = prefix.trim();
  if (!normalized) return;
  let candidate = normalized;
  if (!candidate.endsWith(".")) {
    const lastDotIndex = candidate.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return;
    }
    candidate = candidate.slice(0, lastDotIndex + 1);
  }
  if (!TEMPLATE_PREFIX_PATTERN.test(candidate)) return;
  const namespace = getNamespaceFromKey(candidate);
  if (!namespace || IGNORED_KEY_PREFIXES.has(namespace)) return;
  if (!baselineNamespaces.has(namespace)) return;
  dynamicPrefixes.add(candidate);
}

function addKeyIfValid(key, usedKeys, baselineNamespaces, options = {}) {
  if (!key || typeof key !== "string") return false;
  if (!KEY_PATTERN.test(key)) return false;
  const namespace = getNamespaceFromKey(key);
  if (!namespace || IGNORED_KEY_PREFIXES.has(namespace)) return false;
  if (!options.forceNamespace && !baselineNamespaces.has(namespace)) {
    return false;
  }
  usedKeys.add(key);
  return true;
}

function collectImportSpecifiers(sourceFile) {
  const specifiers = new Map();

  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const moduleText =
      ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text;
    if (!moduleText || !node.importClause) return;

    if (node.importClause.name) {
      specifiers.set(node.importClause.name.text, moduleText);
    }

    const { namedBindings } = node.importClause;
    if (!namedBindings) return;

    if (ts.isNamespaceImport(namedBindings)) {
      specifiers.set(namedBindings.name.text, `${moduleText}.*`);
      return;
    }

    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        specifiers.set(element.name.text, moduleText);
      }
    }
  });

  return specifiers;
}

function getCallExpressionChain(expression) {
  const chain = [];
  let current = expression;
  while (current) {
    if (ts.isIdentifier(current)) {
      chain.unshift(current.text);
      break;
    }
    if (ts.isPropertyAccessExpression(current)) {
      chain.unshift(current.name.text);
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      const argument = current.argumentExpression;
      if (ts.isStringLiteralLike(argument)) {
        chain.unshift(argument.text);
        current = current.expression;
        continue;
      }
      return [];
    }
    break;
  }
  return chain;
}

function classifyCallExpression(expression, importSpecifiers) {
  if (!expression) return null;
  const chain = getCallExpressionChain(expression);
  if (chain.length === 0) return null;

  const last = chain[chain.length - 1];
  const root = chain[0];

  if (last === "t") {
    return { type: "translation", forceNamespace: true };
  }

  if (
    NOTICE_METHOD_NAMES.has(last) &&
    root === "showNotice" &&
    (!importSpecifiers ||
      NOTICE_SERVICE_IDENTIFIERS.has(importSpecifiers.get("showNotice") ?? ""))
  ) {
    return { type: "notice", forceNamespace: true };
  }

  return null;
}

function resolveBindingValue(name, scopeStack) {
  if (!name) return null;
  for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
    const scope = scopeStack[index];
    if (scope && scope.has(name)) {
      return scope.get(name);
    }
  }
  return null;
}

function resolveKeyFromExpression(
  node,
  scopeStack,
  dynamicPrefixes,
  baselineNamespaces,
  importSpecifiers,
) {
  if (!node) return null;

  if (
    ts.isStringLiteralLike(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    addTemplatePrefixCandidate(
      node.head?.text ?? "",
      dynamicPrefixes,
      baselineNamespaces,
    );
    for (const span of node.templateSpans) {
      const literalText = span.literal?.text ?? "";
      const combined = (node.head?.text ?? "") + literalText;
      addTemplatePrefixCandidate(combined, dynamicPrefixes, baselineNamespaces);
    }
    return null;
  }

  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveKeyFromExpression(
        node.left,
        scopeStack,
        dynamicPrefixes,
        baselineNamespaces,
        importSpecifiers,
      );
      const right = resolveKeyFromExpression(
        node.right,
        scopeStack,
        dynamicPrefixes,
        baselineNamespaces,
        importSpecifiers,
      );
      if (left && right) {
        return `${left}${right}`;
      }
      if (left) {
        addTemplatePrefixCandidate(left, dynamicPrefixes, baselineNamespaces);
      }
      return null;
    }
    return null;
  }

  if (ts.isParenthesizedExpression(node)) {
    return resolveKeyFromExpression(
      node.expression,
      scopeStack,
      dynamicPrefixes,
      baselineNamespaces,
      importSpecifiers,
    );
  }

  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return resolveKeyFromExpression(
      node.expression,
      scopeStack,
      dynamicPrefixes,
      baselineNamespaces,
      importSpecifiers,
    );
  }

  if (ts.isIdentifier(node)) {
    return resolveBindingValue(node.text, scopeStack);
  }

  if (ts.isCallExpression(node)) {
    const classification = classifyCallExpression(
      node.expression,
      importSpecifiers,
    );
    if (!classification) return null;
    const firstArg = node.arguments[0];
    if (!firstArg) return null;
    return resolveKeyFromExpression(
      firstArg,
      scopeStack,
      dynamicPrefixes,
      baselineNamespaces,
      importSpecifiers,
    );
  }

  return null;
}

function collectUsedKeysFromTsFile(
  file,
  baselineNamespaces,
  usedKeys,
  dynamicPrefixes,
) {
  let sourceFile;

  try {
    sourceFile = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      determineScriptKind(file.extension),
    );
  } catch (error) {
    console.warn(`Warning: failed to parse ${file.path}: ${error.message}`);
    return;
  }

  const importSpecifiers = collectImportSpecifiers(sourceFile);
  const scopeStack = [new Map()];

  const visit = (node) => {
    let scopePushed = false;
    if (
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      node.kind === ts.SyntaxKind.CaseBlock ||
      ts.isCatchClause(node)
    ) {
      scopeStack.push(new Map());
      scopePushed = true;
    }

    if (ts.isTemplateExpression(node)) {
      resolveKeyFromExpression(
        node,
        scopeStack,
        dynamicPrefixes,
        baselineNamespaces,
        importSpecifiers,
      );
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const key = resolveKeyFromExpression(
        node.initializer,
        scopeStack,
        dynamicPrefixes,
        baselineNamespaces,
        importSpecifiers,
      );
      if (key && KEY_PATTERN.test(key)) {
        if (ts.isIdentifier(node.name)) {
          scopeStack[scopeStack.length - 1].set(node.name.text, key);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const classification = classifyCallExpression(
        node.expression,
        importSpecifiers,
      );
      if (classification) {
        const [firstArg] = node.arguments;
        if (firstArg) {
          const key = resolveKeyFromExpression(
            firstArg,
            scopeStack,
            dynamicPrefixes,
            baselineNamespaces,
            importSpecifiers,
          );
          if (
            !addKeyIfValid(key, usedKeys, baselineNamespaces, classification)
          ) {
            addTemplatePrefixCandidate(
              key ?? "",
              dynamicPrefixes,
              baselineNamespaces,
            );
          }
        }
      }
    }

    if (ts.isJsxAttribute(node) && node.name?.text === "i18nKey") {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteralLike(initializer)) {
        addKeyIfValid(initializer.text, usedKeys, baselineNamespaces, {
          forceNamespace: false,
        });
      } else if (
        initializer &&
        ts.isJsxExpression(initializer) &&
        initializer.expression
      ) {
        const key = resolveKeyFromExpression(
          initializer.expression,
          scopeStack,
          dynamicPrefixes,
          baselineNamespaces,
          importSpecifiers,
        );
        addKeyIfValid(key, usedKeys, baselineNamespaces, {
          forceNamespace: true,
        });
      }
    }

    node.forEachChild(visit);

    if (scopePushed) {
      scopeStack.pop();
    }
  };

  visit(sourceFile);
}

function collectUsedKeysFromTextFile(file, baselineNamespaces, usedKeys) {
  const regex = /['"`]([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)['"`]/g;
  let match;
  while ((match = regex.exec(file.content))) {
    addKeyIfValid(match[1], usedKeys, baselineNamespaces, {
      forceNamespace: false,
    });
  }
}

function collectUsedI18nKeys(sourceFiles, baselineNamespaces) {
  const usedKeys = new Set();
  const dynamicPrefixes = new Set();

  for (const file of sourceFiles) {
    if (TS_EXTENSIONS.has(file.extension)) {
      collectUsedKeysFromTsFile(
        file,
        baselineNamespaces,
        usedKeys,
        dynamicPrefixes,
      );
    } else {
      collectUsedKeysFromTextFile(file, baselineNamespaces, usedKeys);
    }
  }

  return { usedKeys, dynamicPrefixes };
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
  if (
    !target ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    dottedKey === ""
  ) {
    return;
  }

  if (dottedKey in target) {
    delete target[dottedKey];
    return;
  }

  const parts = dottedKey.split(".").filter((part) => part !== "");
  if (parts.length === 0) return;

  let current = target;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(part in current)
    ) {
      return;
    }
    if (index === parts.length - 1) {
      delete current[part];
      return;
    }
    current = current[part];
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

function findKeyInSources(key, sourceFiles) {
  if (fileUsageCache.has(key)) {
    return fileUsageCache.get(key);
  }

  const pattern = new RegExp(`(['"\`])${escapeRegExp(key)}\\1`);
  let found = false;

  for (const file of sourceFiles) {
    if (pattern.test(file.content)) {
      found = true;
      break;
    }
  }

  fileUsageCache.set(key, found);
  return found;
}

function isKeyUsed(key, usage, sourceFiles) {
  if (WHITELIST_KEYS.has(key)) return true;
  if (!key) return false;
  if (usage.usedKeys.has(key)) return true;

  if (dynamicKeyCache.has(key)) {
    return dynamicKeyCache.get(key);
  }

  const prefixes = getCandidatePrefixes(key);
  let used = prefixes.some((prefix) => usage.dynamicPrefixes.has(prefix));

  if (!used) {
    used = findKeyInSources(key, sourceFiles);
  }

  dynamicKeyCache.set(key, used);
  return used;
}

function getCandidatePrefixes(key) {
  if (!key.includes(".")) return [];
  const parts = key.split(".");
  const prefixes = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    const prefix = `${parts.slice(0, index + 1).join(".")}.`;
    prefixes.push(prefix);
  }
  return prefixes;
}

function writeReport(reportPath, data) {
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(reportPath, `${payload}\n`, "utf8");
}

function loadLocales() {
  if (!fs.existsSync(LOCALES_DIR)) {
    throw new Error(`Locales directory not found: ${LOCALES_DIR}`);
  }

  const entries = fs.readdirSync(LOCALES_DIR, { withFileTypes: true });
  const locales = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      if (
        /^[a-z0-9\-_]+\.json$/i.test(entry.name) &&
        !entry.name.endsWith(".bak") &&
        !entry.name.endsWith(".old")
      ) {
        const localePath = path.join(LOCALES_DIR, entry.name);
        const name = path.basename(entry.name, ".json");
        const raw = fs.readFileSync(localePath, "utf8");
        locales.push({
          name,
          dir: LOCALES_DIR,
          format: "single-file",
          files: [
            {
              namespace: "translation",
              path: localePath,
            },
          ],
          data: JSON.parse(raw),
        });
      }
      continue;
    }

    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const localeDir = path.join(LOCALES_DIR, entry.name);
    const namespaceEntries = fs
      .readdirSync(localeDir, { withFileTypes: true })
      .filter(
        (item) =>
          item.isFile() &&
          item.name.endsWith(".json") &&
          !item.name.endsWith(".bak") &&
          !item.name.endsWith(".old"),
      )
      .map((item) => ({
        namespace: path.basename(item.name, ".json"),
        path: path.join(localeDir, item.name),
      }));

    namespaceEntries.sort((a, b) => a.path.localeCompare(b.path));

    const data = {};
    for (const file of namespaceEntries) {
      const raw = fs.readFileSync(file.path, "utf8");
      try {
        data[file.namespace] = JSON.parse(raw);
      } catch (error) {
        console.warn(`Warning: failed to parse ${file.path}: ${error.message}`);
        data[file.namespace] = {};
      }
    }

    locales.push({
      name: entry.name,
      dir: localeDir,
      format: "multi-file",
      files: namespaceEntries,
      data,
    });
  }

  locales.sort((a, b) => a.name.localeCompare(b.name));
  return locales;
}

function ensureBackup(localePath) {
  const backupPath = `${localePath}.bak`;
  if (fs.existsSync(backupPath)) {
    try {
      fs.rmSync(backupPath);
    } catch (error) {
      throw new Error(
        `Failed to recycle existing backup for ${path.basename(
          localePath,
        )}: ${error.message}`,
      );
    }
  }
  fs.copyFileSync(localePath, backupPath);
  return backupPath;
}

function backupIfNeeded(filePath, backups, options) {
  if (!options.backup) return;
  if (!fs.existsSync(filePath)) return;
  if (backups.has(filePath)) return;
  const backupPath = ensureBackup(filePath);
  backups.set(filePath, backupPath);
  return backupPath;
}

function cleanupBackups(backups) {
  for (const backupPath of backups.values()) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath);
      }
    } catch (error) {
      console.warn(
        `Warning: failed to remove backup ${path.basename(
          backupPath,
        )}: ${error.message}`,
      );
    }
  }
  backups.clear();
}

function toModuleIdentifier(namespace, seen) {
  const RESERVED = new Set([
    "default",
    "function",
    "var",
    "let",
    "const",
    "import",
    "export",
    "class",
    "enum",
  ]);

  const base =
    namespace.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^[^a-zA-Z_$]+/, "") ||
    "ns";

  let candidate = base;
  let counter = 1;
  while (RESERVED.has(candidate) || seen.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  seen.add(candidate);
  return candidate;
}

function regenerateLocaleIndex(localeDir, namespaces) {
  const seen = new Set();
  const imports = [];
  const mappings = [];

  for (const namespace of namespaces) {
    const filePath = path.join(localeDir, `${namespace}.json`);
    if (!fs.existsSync(filePath)) continue;
    const identifier = toModuleIdentifier(namespace, seen);
    imports.push(`import ${identifier} from "./${namespace}.json";`);
    mappings.push(`  "${namespace}": ${identifier},`);
  }

  const content = `${imports.join("\n")}

const resources = {
${mappings.join("\n")}
};

export default resources;
`;

  fs.writeFileSync(path.join(localeDir, "index.ts"), content, "utf8");
}

function writeLocale(locale, data, options) {
  const backups = new Map();
  let success = false;

  try {
    if (locale.format === "single-file") {
      const target = locale.files[0].path;
      backupIfNeeded(target, backups, options);
      const serialized = JSON.stringify(data, null, 2);
      fs.writeFileSync(target, `${serialized}\n`, "utf8");
      success = true;
      return;
    }

    const entries = Object.entries(data);
    const orderedNamespaces = entries.map(([namespace]) => namespace);
    const existingFiles = new Map(
      locale.files.map((file) => [file.namespace, file.path]),
    );
    const visited = new Set();

    for (const [namespace, value] of entries) {
      const target =
        existingFiles.get(namespace) ??
        path.join(locale.dir, `${namespace}.json`);
      backupIfNeeded(target, backups, options);
      const serialized = JSON.stringify(value ?? {}, null, 2);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${serialized}\n`, "utf8");
      visited.add(namespace);
    }

    for (const [namespace, filePath] of existingFiles.entries()) {
      if (!visited.has(namespace) && fs.existsSync(filePath)) {
        backupIfNeeded(filePath, backups, options);
        fs.rmSync(filePath);
      }
    }

    regenerateLocaleIndex(locale.dir, orderedNamespaces);
    locale.files = orderedNamespaces.map((namespace) => ({
      namespace,
      path: path.join(locale.dir, `${namespace}.json`),
    }));
    success = true;
  } finally {
    if (success) {
      cleanupBackups(backups);
    }
  }
}

function processLocale(
  locale,
  baselineData,
  baselineEntries,
  usage,
  sourceFiles,
  missingFromSource,
  options,
) {
  const data = JSON.parse(JSON.stringify(locale.data));
  const flattened = flattenLocale(data);
  const expectedTotal = baselineEntries.size;

  const { missing, extra } = diffLocaleKeys(baselineEntries, flattened);

  const unused = [];
  for (const key of flattened.keys()) {
    if (!isKeyUsed(key, usage, sourceFiles)) {
      unused.push(key);
    }
  }

  const sourceMissing =
    locale.name === options.baseline
      ? missingFromSource.filter((key) => !flattened.has(key))
      : [];

  if (
    unused.length === 0 &&
    missing.length === 0 &&
    extra.length === 0 &&
    sourceMissing.length === 0 &&
    !options.align
  ) {
    console.log(`[${locale.name}] No issues detected 🎉`);
  } else {
    console.log(`[${locale.name}] Check results:`);
    console.log(
      `  unused: ${unused.length}, missing vs baseline: ${missing.length}, extra: ${extra.length}`,
    );
    if (sourceMissing.length > 0) {
      console.log(`  missing in source: ${sourceMissing.length}`);
      logPreviewEntries("missing-source", sourceMissing);
    }
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

    writeLocale(locale, updated, options);
    locale.data = JSON.parse(JSON.stringify(updated));
    console.log(
      `[${locale.name}] Locale resources updated (${removed.length} unused removed${
        aligned ? ", structure aligned" : ""
      })`,
    );
  }

  return {
    locale: locale.name,
    file: locale.format === "single-file" ? locale.files[0].path : locale.dir,
    totalKeys: flattened.size,
    expectedKeys: expectedTotal,
    unusedKeys: unused,
    removed,
    missingKeys: missing,
    extraKeys: extra,
    missingSourceKeys: sourceMissing,
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

  const sourceFiles = collectSourceFiles(sourceDirs);
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

  const baselineData = JSON.parse(JSON.stringify(baselineLocale.data));
  const baselineEntries = flattenLocale(baselineData);
  const baselineNamespaces = new Set(Object.keys(baselineData));
  const usage = collectUsedI18nKeys(sourceFiles, baselineNamespaces);
  const baselineKeys = new Set(baselineEntries.keys());
  const missingFromSource = Array.from(usage.usedKeys).filter(
    (key) => !baselineKeys.has(key),
  );
  missingFromSource.sort();

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
      usage,
      sourceFiles,
      missingFromSource,
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
  const totalSourceMissing = results.reduce(
    (count, result) => count + result.missingSourceKeys.length,
    0,
  );

  console.log("\nSummary:");
  for (const result of results) {
    console.log(
      `  • ${result.locale}: unused=${result.unusedKeys.length}, missing=${result.missingKeys.length}, extra=${result.extraKeys.length}, missingSource=${result.missingSourceKeys.length}, total=${result.totalKeys}, expected=${result.expectedKeys}`,
    );
  }
  console.log(
    `\nTotals → unused: ${totalUnused}, missing: ${totalMissing}, extra: ${totalExtra}, missingSource: ${totalSourceMissing}`,
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
