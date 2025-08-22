// scripts/publish-version.mjs
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "release-version.mjs");

if (!existsSync(scriptPath)) {
  console.error("release-version.mjs not found!");
  process.exit(1);
}

const versionArg = process.argv[2];
if (!versionArg) {
  console.error("Usage: pnpm publish-version <version>");
  process.exit(1);
}

// 1. 调用 release-version.mjs
const runRelease = () =>
  new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, versionArg], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("release-version failed"));
    });
  });

// 2. 判断是否需要打 tag
function isSemver(version) {
  return /^v?\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/.test(version);
}

async function run() {
  await runRelease();

  let tag = null;
  if (versionArg === "alpha") {
    // 读取 package.json 里的主版本
    const pkg = await import(path.join(rootDir, "package.json"), {
      assert: { type: "json" },
    });
    tag = `v${pkg.default.version}-alpha`;
  } else if (isSemver(versionArg)) {
    // 1.2.3 或 v1.2.3
    tag = versionArg.startsWith("v") ? versionArg : `v${versionArg}`;
  }

  if (tag) {
    // 打 tag 并推送
    const { execSync } = await import("child_process");
    try {
      execSync(`git tag ${tag}`, { stdio: "inherit" });
      execSync(`git push origin ${tag}`, { stdio: "inherit" });
      console.log(`[INFO]: Git tag ${tag} created and pushed.`);
    } catch {
      console.error(`[ERROR]: Failed to create or push git tag: ${tag}`);
      process.exit(1);
    }
  } else {
    console.log("[INFO]: No git tag created for this version.");
  }
}

run();
