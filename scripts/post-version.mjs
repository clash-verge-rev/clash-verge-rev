import fs from "fs-extra";
import { createRequire } from "module";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);

// update the tauri conf version
async function resolveVersion() {
  const { version } = require("../package.json");
  const tauri = require("../src-tauri/tauri.conf.json");

  tauri.package.version = version;

  await fs.writeFile(
    "./src-tauri/tauri.conf.json",
    JSON.stringify(tauri, undefined, 2)
  );
  execSync("git add ./src-tauri/tauri.conf.json");
  execSync(`git commit -m v${version} --no-verify`);
  execSync(`git push`);
  execSync(`git push origin v${version}`);
}

resolveVersion();
