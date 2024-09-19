import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { createRequire } from "module";
import { getOctokit, context } from "@actions/github";

const target = process.argv.slice(2)[0];
const alpha = process.argv.slice(2)[1];

const ARCH_MAP = {
  "x86_64-pc-windows-msvc": "x64",
  "i686-pc-windows-msvc": "x86",
  "aarch64-pc-windows-msvc": "arm64",
};

const PROCESS_MAP = {
  x64: "x64",
  ia32: "x86",
  arm64: "arm64",
};
const arch = target ? ARCH_MAP[target] : PROCESS_MAP[process.arch];
/// Script for ci
/// 打包绿色版/便携版 (only Windows)
async function resolvePortable() {
  if (process.platform !== "win32") return;

  const releaseDir = target
    ? `./src-tauri/target/${target}/release`
    : `./src-tauri/target/release`;

  const configDir = path.join(releaseDir, ".config");

  if (!fs.existsSync(releaseDir)) {
    throw new Error("could not found the release dir");
  }

  await fsp.mkdir(configDir, { recursive: true });
  if (!fs.existsSync(path.join(configDir, "PORTABLE"))) {
    await fsp.writeFile(path.join(configDir, "PORTABLE"), "");
  }

  const zip = new AdmZip();

  zip.addLocalFile(path.join(releaseDir, "Clash Verge.exe"));
  zip.addLocalFile(path.join(releaseDir, "verge-mihomo.exe"));
  zip.addLocalFile(path.join(releaseDir, "verge-mihomo-alpha.exe"));
  zip.addLocalFolder(path.join(releaseDir, "resources"), "resources");
  zip.addLocalFolder(
    path.join(
      releaseDir,
      `Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.${arch}`
    ),
    `Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.${arch}`
  );
  zip.addLocalFolder(configDir, ".config");

  const require = createRequire(import.meta.url);
  const packageJson = require("../package.json");
  const { version } = packageJson;

  const zipFile = `Clash.Verge_${version}_${arch}_fixed_webview2_portable.zip`;
  zip.writeZip(zipFile);

  console.log("[INFO]: create portable zip successfully");

  // push release assets
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);
  const tag = alpha ? "alpha" : process.env.TAG_NAME || `v${version}`;
  console.log("[INFO]: upload to ", tag);

  const { data: release } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag,
  });

  let assets = release.assets.filter((x) => {
    return x.name === zipFile;
  });
  if (assets.length > 0) {
    let id = assets[0].id;
    await github.rest.repos.deleteReleaseAsset({
      ...options,
      asset_id: id,
    });
  }

  console.log(release.name);

  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: release.id,
    name: zipFile,
    data: zip.toBuffer(),
  });
}

resolvePortable().catch(console.error);
