/**
 * Build and upload assets
 * for macOS(aarch)
 */
import fs from "fs/promises";
import path from "path";
import { exit } from "process";
import { exec } from "child_process";
import { createRequire } from "module";
import { getOctokit, context } from "@actions/github";

const require = createRequire(import.meta.url);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function resolve() {
  try {
    const {
      GITHUB_REPOSITORY,
      TAURI_PRIVATE_KEY,
      TAURI_KEY_PASSWORD,
    } = process.env;

    if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !TAURI_PRIVATE_KEY || !TAURI_KEY_PASSWORD) {
      throw new Error("Environment variables are not set properly");
    }

    const { version } = require("../package.json");
    const tag = process.argv.includes("--meta") ? "meta" : process.argv.includes("--alpha") ? "alpha" : `v${version}`;
    const buildCmd = process.argv.includes("--meta") ? "pnpm build -f default-meta" : "pnpm build";

    console.log(`[INFO]: Upload to tag "${tag}"`);
    console.log(`[INFO]: Building app. "${buildCmd}"`);

    await execAsync(buildCmd);

    const bundlePath = path.resolve("src-tauri/target/release/bundle");

    const appPathList = [
      path.resolve(bundlePath, "macos/Clash Verge.aarch64.app.tar.gz"),
      path.resolve(bundlePath, "macos/Clash Verge.aarch64.app.tar.gz.sig"),
    ];

    for (const appPath of appPathList) {
      await fs.unlink(appPath).catch(() => {}); // 删除文件，如果存在的话
    }

    await fs.copyFile(path.resolve(bundlePath, "macos/Clash Verge.app.tar.gz"), appPathList[0]);
    await fs.copyFile(path.resolve(bundlePath, "macos/Clash Verge.app.tar.gz.sig"), appPathList[1]);

    const options = { owner: context.repo.owner, repo: context.repo.repo };
    const github = getOctokit(GITHUB_TOKEN);

    const { data: release } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag,
    });

    if (!release.id) throw new Error("Failed to find the release");

    await uploadAssets(release.id, [
      path.resolve(bundlePath, `dmg/Clash Verge_${version}_aarch64.dmg`),
      ...appPathList,
    ]);
  } catch (error) {
    console.error(`[ERROR]: ${error.message}`);
    exit(1);
  }
}

async function execAsync(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${command}\n${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function uploadAssets(releaseId, assets) {
  const github = getOctokit(GITHUB_TOKEN);

  for (const assetPath of assets) {
    const headers = {
      "content-type": "application/zip",
      "content-length": (await fs.stat(assetPath)).size,
    };

    const ext = path.extname(assetPath);
    const filename = path.basename(assetPath, ext);
    const assetName = path.dirname(assetPath).includes(`target${path.sep}debug`) ?
      `${filename}-debug${ext}` :
      `${filename}${ext}`;

    console.log(`[INFO]: Uploading ${assetName}...`);

    try {
      await github.rest.repos.uploadReleaseAsset({
        headers,
        name: assetName,
        data: await fs.readFile(assetPath),
        owner: context.repo.owner,
        repo: context.repo.repo,
        release_id: releaseId,
      });
    } catch (error) {
      console.error(`[ERROR]: ${error.message}`);
    }
  }
}

if (process.platform === "darwin" && process.arch === "arm64") {
  resolve();
} else {
  console.error("Invalid platform");
  exit(1);
}
