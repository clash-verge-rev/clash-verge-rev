/**
 * Build and upload assets
 * for macOS(aarch)
 */
import fs from "fs-extra";
import path from "path";
import { exit } from "process";
import { execSync } from "child_process";
import { createRequire } from "module";
import { getOctokit, context } from "@actions/github";

// to `meta` tag
const META = process.argv.includes("--meta");
// to `alpha` tag
const ALPHA = process.argv.includes("--alpha");

const require = createRequire(import.meta.url);

async function resolve() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!process.env.GITHUB_REPOSITORY) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  if (!process.env.TAURI_PRIVATE_KEY) {
    throw new Error("TAURI_PRIVATE_KEY is required");
  }
  if (!process.env.TAURI_KEY_PASSWORD) {
    throw new Error("TAURI_KEY_PASSWORD is required");
  }

  const { version } = require("../package.json");

  const tag = META ? "meta" : ALPHA ? "alpha" : `v${version}`;
  const buildCmd = META ? `yarn build -f default-meta` : `yarn build`;

  console.log(`[INFO]: Upload to tag "${tag}"`);
  console.log(`[INFO]: Building app. "${buildCmd}"`);

  execSync(buildCmd);

  const cwd = process.cwd();
  const bundlePath = path.join(cwd, "src-tauri/target/release/bundle");
  const join = (p) => path.join(bundlePath, p);

  const appPathList = [
    join("macos/Clash Verge.aarch64.app.tar.gz"),
    join("macos/Clash Verge.aarch64.app.tar.gz.sig"),
  ];

  for (const appPath of appPathList) {
    if (fs.pathExistsSync(appPath)) {
      fs.removeSync(appPath);
    }
  }

  fs.copyFileSync(join("macos/Clash Verge.app.tar.gz"), appPathList[0]);
  fs.copyFileSync(join("macos/Clash Verge.app.tar.gz.sig"), appPathList[1]);

  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);

  const { data: release } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag,
  });

  if (!release.id) throw new Error("failed to find the release");

  await uploadAssets(release.id, [
    join(`dmg/Clash Verge_${version}_aarch64.dmg`),
    ...appPathList,
  ]);
}

// From tauri-apps/tauri-action
// https://github.com/tauri-apps/tauri-action/blob/dev/packages/action/src/upload-release-assets.ts
async function uploadAssets(releaseId, assets) {
  const github = getOctokit(process.env.GITHUB_TOKEN);

  // Determine content-length for header to upload asset
  const contentLength = (filePath) => fs.statSync(filePath).size;

  for (const assetPath of assets) {
    const headers = {
      "content-type": "application/zip",
      "content-length": contentLength(assetPath),
    };

    const ext = path.extname(assetPath);
    const filename = path.basename(assetPath).replace(ext, "");
    const assetName = path.dirname(assetPath).includes(`target${path.sep}debug`)
      ? `${filename}-debug${ext}`
      : `${filename}${ext}`;

    console.log(`[INFO]: Uploading ${assetName}...`);

    try {
      await github.rest.repos.uploadReleaseAsset({
        headers,
        name: assetName,
        data: fs.readFileSync(assetPath),
        owner: context.repo.owner,
        repo: context.repo.repo,
        release_id: releaseId,
      });
    } catch (error) {
      console.log(error.message);
    }
  }
}

if (process.platform === "darwin" && process.arch === "arm64") {
  resolve();
} else {
  console.error("invalid");
  exit(1);
}
