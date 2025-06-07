import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.resolve(__dirname, "../src/locales");
const SRC_DIRS = [
  path.resolve(__dirname, "../src"),
  path.resolve(__dirname, "../src-tauri"),
];
const exts = [".js", ".ts", ".tsx", ".jsx", ".vue", ".rs"];

// 递归获取所有文件
function getAllFiles(dir, exts) {
  let files = [];
  fs.readdirSync(dir).forEach((file) => {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      files = files.concat(getAllFiles(full, exts));
    } else if (exts.includes(path.extname(full))) {
      files.push(full);
    }
  });
  return files;
}

// 读取所有源码内容为一个大字符串
function getAllSourceContent() {
  const files = SRC_DIRS.flatMap((dir) => getAllFiles(dir, exts));
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

// 白名单 key，不检查这些 key 是否被使用
const WHITELIST_KEYS = [
  "theme.light",
  "theme.dark",
  "theme.system",
  "Already Using Latest Core Version",
];

// 主流程
function processI18nFile(i18nPath, lang, allSource) {
  const i18n = JSON.parse(fs.readFileSync(i18nPath, "utf8"));
  const keys = Object.keys(i18n);

  const used = {};
  const unused = [];

  let checked = 0;
  const total = keys.length;
  keys.forEach((key) => {
    if (WHITELIST_KEYS.includes(key)) {
      used[key] = i18n[key];
    } else {
      // 只查找一次
      const regex = new RegExp(`["'\`]${key}["'\`]`);
      if (regex.test(allSource)) {
        used[key] = i18n[key];
      } else {
        unused.push(key);
      }
    }
    checked++;
    if (checked % 20 === 0 || checked === total) {
      const percent = ((checked / total) * 100).toFixed(1);
      process.stdout.write(
        `\r[${lang}] Progress: ${checked}/${total} (${percent}%)`,
      );
      if (checked === total) process.stdout.write("\n");
    }
  });

  // 输出未使用的 key
  console.log(`\n[${lang}] Unused keys:`, unused);

  // 备份原文件
  const oldPath = i18nPath + ".old";
  fs.renameSync(i18nPath, oldPath);

  // 写入精简后的 i18n 文件（保留原文件名）
  fs.writeFileSync(i18nPath, JSON.stringify(used, null, 2), "utf8");
  console.log(
    `[${lang}] Cleaned i18n file written to src/locales/${path.basename(i18nPath)}`,
  );
  console.log(`[${lang}] Original file backed up as ${path.basename(oldPath)}`);
}

function main() {
  // 支持 zhtw.json、zh-tw.json、zh_CN.json 等
  const files = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => /^[a-z0-9\-_]+\.json$/i.test(f) && !f.endsWith(".old"));
  const allSource = getAllSourceContent();
  files.forEach((file) => {
    const lang = path.basename(file, ".json");
    processI18nFile(path.join(LOCALES_DIR, file), lang, allSource);
  });
}

main();
