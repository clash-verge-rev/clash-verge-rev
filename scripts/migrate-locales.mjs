// scripts/migrate-locales.ts (Node.js + TypeScript)

import fs from "fs";
import path from "path";

const inputDir = "src/locales";
const outputDir = "locales"; // 你可以用于 Crowdin 的根目录
const outputFileName = "translation.json";

fs.mkdirSync(outputDir, { recursive: true });

const files = fs.readdirSync(inputDir);

for (const file of files) {
  if (!file.endsWith(".json")) continue;

  const langCode = file.replace(".json", "");
  const content = fs.readFileSync(path.join(inputDir, file), "utf8");

  const langDir = path.join(outputDir, langCode);
  fs.mkdirSync(langDir, { recursive: true });

  fs.writeFileSync(path.join(langDir, outputFileName), content);
}
