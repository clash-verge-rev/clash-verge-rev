/**
 * CLI tool to update version numbers in package.json, src-tauri/Cargo.toml, and src-tauri/tauri.conf.json.
 *
 * Usage:
 *   pnpm release-version <version>
 *
 * <version> can be:
 *   - A full semver version (e.g., 1.2.3, v1.2.3, 1.2.3-beta, v1.2.3+build)
 *   - A tag: "alpha", "beta", "rc", or "autobuild"
 *     - "alpha", "beta", "rc": Appends the tag to the current base version (e.g., 1.2.3-beta)
 *     - "autobuild": Appends a timestamped autobuild tag (e.g., 1.2.3+autobuild.2406101530)
 *
 * Examples:
 *   pnpm release-version 1.2.3
 *   pnpm release-version v1.2.3-beta
 *   pnpm release-version beta
 *   pnpm release-version autobuild
 *
 * The script will:
 *   - Validate and normalize the version argument
 *   - Update the version field in package.json
 *   - Update the version field in src-tauri/Cargo.toml
 *   - Update the version field in src-tauri/tauri.conf.json
 *
 * Errors are logged and the process exits with code 1 on failure.
 */

import fs from "fs/promises";
import path from "path";
import { program } from "commander";
import { execSync } from "child_process";

/**
 * 获取当前 git 短 commit hash
 * @returns {string}
 */
function getGitShortCommit() {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch (e) {
    console.warn("[WARN]: Failed to get git short commit, fallback to 'nogit'");
    return "nogit";
  }
}

/**
 * 生成短时间戳（格式：YYMMDD）或带 commit（格式：YYMMDD.cc39b27）
 * @param {boolean} withCommit 是否带 commit
 * @returns {string}
 */
function generateShortTimestamp(withCommit = false) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  if (withCommit) {
    const gitShort = getGitShortCommit();
    return `${month}${day}.${gitShort}`;
  }
  return `${month}${day}`;
}

/**
 * 验证版本号格式
 * @param {string} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  return /^v?\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/i.test(
    version,
  );
}

/**
 * 标准化版本号
 * @param {string} version
 * @returns {string}
 */
function normalizeVersion(version) {
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * 提取基础版本号（去掉所有 -tag 和 +build 部分）
 * @param {string} version
 * @returns {string}
 */
function getBaseVersion(version) {
  let base = version.replace(/-(alpha|beta|rc)(\.\d+)?/i, "");
  base = base.replace(/\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*/g, "");
  return base;
}

/**
 * 更新 package.json 版本号
 * @param {string} newVersion
 */
async function updatePackageVersion(newVersion) {
  const _dirname = process.cwd();
  const packageJsonPath = path.join(_dirname, "package.json");
  try {
    const data = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(data);

    console.log(
      "[INFO]: Current package.json version is: ",
      packageJson.version,
    );
    packageJson.version = newVersion.startsWith("v")
      ? newVersion.slice(1)
      : newVersion;
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf8",
    );
    console.log(
      `[INFO]: package.json version updated to: ${packageJson.version}`,
    );
  } catch (error) {
    console.error("Error updating package.json version:", error);
    throw error;
  }
}

/**
 * 更新 Cargo.toml 版本号
 * @param {string} newVersion
 */
async function updateCargoVersion(newVersion) {
  const _dirname = process.cwd();
  const cargoTomlPath = path.join(_dirname, "src-tauri", "Cargo.toml");
  try {
    const data = await fs.readFile(cargoTomlPath, "utf8");
    const lines = data.split("\n");
    const versionWithoutV = newVersion.startsWith("v")
      ? newVersion.slice(1)
      : newVersion;
    const baseVersion = getBaseVersion(versionWithoutV);

    const updatedLines = lines.map((line) => {
      if (line.trim().startsWith("version =")) {
        return line.replace(
          /version\s*=\s*"[^"]+"/,
          `version = "${baseVersion}"`,
        );
      }
      return line;
    });

    await fs.writeFile(cargoTomlPath, updatedLines.join("\n"), "utf8");
    console.log(`[INFO]: Cargo.toml version updated to: ${baseVersion}`);
  } catch (error) {
    console.error("Error updating Cargo.toml version:", error);
    throw error;
  }
}

/**
 * 更新 tauri.conf.json 版本号
 * @param {string} newVersion
 */
async function updateTauriConfigVersion(newVersion) {
  const _dirname = process.cwd();
  const tauriConfigPath = path.join(_dirname, "src-tauri", "tauri.conf.json");
  try {
    const data = await fs.readFile(tauriConfigPath, "utf8");
    const tauriConfig = JSON.parse(data);
    const versionWithoutV = newVersion.startsWith("v")
      ? newVersion.slice(1)
      : newVersion;
    const baseVersion = getBaseVersion(versionWithoutV);

    console.log(
      "[INFO]: Current tauri.conf.json version is: ",
      tauriConfig.version,
    );
    tauriConfig.version = baseVersion;
    await fs.writeFile(
      tauriConfigPath,
      JSON.stringify(tauriConfig, null, 2),
      "utf8",
    );
    console.log(`[INFO]: tauri.conf.json version updated to: ${baseVersion}`);
  } catch (error) {
    console.error("Error updating tauri.conf.json version:", error);
    throw error;
  }
}

/**
 * 获取当前版本号
 */
async function getCurrentVersion() {
  const _dirname = process.cwd();
  const packageJsonPath = path.join(_dirname, "package.json");
  try {
    const data = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(data);
    return packageJson.version;
  } catch (error) {
    console.error("Error getting current version:", error);
    throw error;
  }
}

/**
 * 主函数
 */
async function main(versionArg) {
  if (!versionArg) {
    console.error("Error: Version argument is required");
    process.exit(1);
  }

  try {
    let newVersion;
    const validTags = ["alpha", "beta", "rc", "autobuild"];

    if (validTags.includes(versionArg.toLowerCase())) {
      const currentVersion = await getCurrentVersion();
      const baseVersion = getBaseVersion(currentVersion);

      if (versionArg.toLowerCase() === "autobuild") {
        // 格式: 2.3.0+autobuild.250613.cc39b27
        newVersion = `${baseVersion}+autobuild.${generateShortTimestamp(true)}`;
      } else {
        newVersion = `${baseVersion}-${versionArg.toLowerCase()}`;
      }
    } else {
      if (!isValidVersion(versionArg)) {
        console.error("Error: Invalid version format");
        process.exit(1);
      }
      newVersion = normalizeVersion(versionArg);
    }

    console.log(`[INFO]: Updating versions to: ${newVersion}`);
    await updatePackageVersion(newVersion);
    await updateCargoVersion(newVersion);
    await updateTauriConfigVersion(newVersion);
    console.log("[SUCCESS]: All version updates completed successfully!");
  } catch (error) {
    console.error("[ERROR]: Failed to update versions:", error);
    process.exit(1);
  }
}

program
  .name("pnpm release-version")
  .description("Update project version numbers")
  .argument("<version>", "version tag or full version")
  .action(main)
  .parse(process.argv);
