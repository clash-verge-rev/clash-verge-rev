#!/usr/bin/env node

/**
 * One-time helper to split flat locale JSON files (e.g. en.json)
 * into per-namespace files (e.g. en/shared.json, en/settings.json).
 */

import fs from "fs/promises";
import path from "path";
import process from "process";

const ROOT = process.cwd();
const LOCALES_DIR = path.join(ROOT, "src/locales");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

const RESERVED = new Set(["default", "function", "var", "let", "const", "import"]);

function toIdentifier(namespace, taken) {
  let base = namespace
    .replace(/[^a-zA-Z0-9_$]/g, "_")
    .replace(/^[^a-zA-Z_$]+/, "");
  if (!base) {
    base = "ns";
  }
  let candidate = base;
  let counter = 1;
  while (RESERVED.has(candidate) || taken.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  taken.add(candidate);
  return candidate;
}

async function splitLocaleFile(filePath, lang) {
  const raw = await fs.readFile(filePath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Locale file ${filePath} must contain a JSON object`);
  }

  const langDir = path.join(LOCALES_DIR, lang);
  await ensureDir(langDir);

  const namespaces = Object.entries(data);
  if (namespaces.length === 0) {
    console.warn(`Locale ${lang} has no keys, skipping.`);
    return;
  }

  const identifiers = new Map();
  const taken = new Set();

  for (const [namespace, value] of namespaces) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new Error(
        `Locale ${lang} namespace "${namespace}" must be an object`,
      );
    }

    const targetPath = path.join(langDir, `${namespace}.json`);
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    await fs.writeFile(targetPath, payload, "utf-8");

    identifiers.set(namespace, toIdentifier(namespace, taken));
  }

  const importLines = namespaces
    .map(([namespace]) => {
      const ident = identifiers.get(namespace);
      return `import ${ident} from "./${namespace}.json";`;
    })
    .join("\n");
  const exportBody = namespaces
    .map(([namespace]) => {
      const ident = identifiers.get(namespace);
      return `  "${namespace}": ${ident},`;
    })
    .join("\n");
  const indexContent = `${importLines}

const resources = {
${exportBody}
};

export default resources;
`;
  await fs.writeFile(path.join(langDir, "index.ts"), indexContent, "utf-8");

  await fs.rm(filePath);
  console.log(`Split ${lang}.json into ${namespaces.length} namespaces.`);
}

async function main() {
  const entries = await fs.readdir(LOCALES_DIR, { withFileTypes: true });
  const localeFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  );

  if (localeFiles.length === 0) {
    console.log("No flat locale JSON files found. Nothing to do.");
    return;
  }

  for (const entry of localeFiles) {
    const lang = entry.name.replace(/\.json$/, "");
    const filePath = path.join(LOCALES_DIR, entry.name);
    await splitLocaleFile(filePath, lang);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
