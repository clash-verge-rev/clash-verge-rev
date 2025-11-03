/**
 * CLI tool to update version numbers in package.json, src-tauri/Cargo.toml, and src-tauri/tauri.conf.json.
 *
 * Usage:
 *   pnpm release-version <version>
 *
 * <version> can be:
 *   - A full semver version (e.g., 1.2.3, v1.2.3, 1.2.3-beta, v1.2.3-rc.1)
 *   - A tag: "alpha", "beta", "rc", "autobuild", "autobuild-latest", or "deploytest"
 *     - "alpha", "beta", "rc": Appends the tag to the current base version (e.g., 1.2.3-beta)
 *     - "autobuild": Appends a timestamped autobuild tag (e.g., 1.2.3-autobuild.0610.cc39b2.r2)
 *     - "autobuild-latest": Appends an autobuild tag with latest Tauri commit (e.g., 1.2.3-autobuild.0610.a1b2c3d.r2)
 *     - "deploytest": Appends a timestamped deploytest tag (e.g., 1.2.3-deploytest.0610.cc39b2.r2)
 *
 * Examples:
 *   pnpm release-version 1.2.3
 *   pnpm release-version v1.2.3-beta
 *   pnpm release-version beta
 *   pnpm release-version autobuild
 *   pnpm release-version autobuild-latest
 *   pnpm release-version deploytest
 *
 * The script will:
 *   - Validate and normalize the version argument
 *   - Update the version field in package.json
 *   - Update the version field in src-tauri/Cargo.toml
 *   - Update the version field in src-tauri/tauri.conf.json
 *
 * Errors are logged and the process exits with code 1 on failure.
 */

import { execSync } from "child_process";
import fs from "fs/promises";
import process from "node:process";
import path from "path";

import { program } from "commander";

/**
 * 获取当前 git 短 commit hash
 * @returns {string}
 */
function getGitShortCommit() {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    console.warn("[WARN]: Failed to get git short commit, fallback to 'nogit'");
    return "nogit";
  }
}

/**
 * 获取最新 Tauri 相关提交的短 hash
 * @returns {string}
 */
function getLatestTauriCommit() {
  try {
    const fullHash = execSync(
      "bash ./scripts-workflow/get_latest_tauri_commit.bash",
    )
      .toString()
      .trim();
    const shortHash = execSync(`git rev-parse --short ${fullHash}`)
      .toString()
      .trim();
    console.log(`[INFO]: Latest Tauri-related commit: ${shortHash}`);
    return shortHash;
  } catch (error) {
    console.warn(
      "[WARN]: Failed to get latest Tauri commit, fallback to current git short commit",
    );
    console.warn(`[WARN]: Error details: ${error.message}`);
    return getGitShortCommit();
  }
}

/**
 * 获取 Asia/Shanghai 时区的日期片段
 * @returns {string}
 */
function getLocalDatePart() {
  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  });
  const dateParts = Object.fromEntries(
    dateFormatter.formatToParts(now).map((part) => [part.type, part.value]),
  );

  const month = dateParts.month ?? "00";
  const day = dateParts.day ?? "00";

  return `${month}${day}`;
}

/**
 * 获取 GitHub Actions 运行编号（若存在）
 * @returns {string|null}
 */
function getRunIdentifier() {
  const runNumber = process.env.GITHUB_RUN_NUMBER;
  if (runNumber && /^[0-9]+$/.test(runNumber)) {
    const runNum = Number.parseInt(runNumber, 10);
    if (!Number.isNaN(runNum)) {
      const base = `r${runNum.toString(36)}`;
      const attempt = process.env.GITHUB_RUN_ATTEMPT;
      if (attempt && /^[0-9]+$/.test(attempt)) {
        const attemptNumber = Number.parseInt(attempt, 10);
        if (!Number.isNaN(attemptNumber) && attemptNumber > 1) {
          return `${base}${attemptNumber.toString(36)}`;
        }
      }
      return base;
    }
  }

  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (attempt && /^[0-9]+$/.test(attempt)) {
    const attemptNumber = Number.parseInt(attempt, 10);
    if (!Number.isNaN(attemptNumber)) {
      return `r${attemptNumber.toString(36)}`;
    }
  }

  return null;
}

/**
 * 生成用于自动构建类渠道的版本后缀
 * @param {Object} options
 * @param {boolean} [options.includeCommit=false]
 * @param {"current"|"tauri"} [options.commitSource="current"]
 * @param {boolean} [options.includeRun=true]
 * @returns {string}
 */
function generateChannelSuffix({
  includeCommit = false,
  commitSource = "current",
  includeRun = true,
} = {}) {
  const segments = [];
  const date = getLocalDatePart();
  segments.push(date);

  if (includeCommit) {
    const commit =
      commitSource === "tauri" ? getLatestTauriCommit() : getGitShortCommit();
    segments.push(commit);
  }

  if (includeRun) {
    const run = getRunIdentifier();
    if (run) {
      segments.push(run);
    }
  }

  return segments.join(".");
}

/**
 * 验证版本号格式
 * @param {string} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
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
 * 提取基础版本号（去掉所有 pre-release 和 build metadata）
 * @param {string} version
 * @returns {string}
 */
function getBaseVersion(version) {
  const cleaned = version.startsWith("v") ? version.slice(1) : version;
  const withoutBuild = cleaned.split("+")[0];
  const [base] = withoutBuild.split("-");
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

    const updatedLines = lines.map((line) => {
      if (line.trim().startsWith("version =")) {
        return line.replace(
          /version\s*=\s*"[^"]+"/,
          `version = "${versionWithoutV}"`,
        );
      }
      return line;
    });

    await fs.writeFile(cargoTomlPath, updatedLines.join("\n"), "utf8");
    console.log(`[INFO]: Cargo.toml version updated to: ${versionWithoutV}`);
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

    console.log(
      "[INFO]: Current tauri.conf.json version is: ",
      tauriConfig.version,
    );

    // 使用完整版本信息，包含build metadata
    tauriConfig.version = versionWithoutV;

    await fs.writeFile(
      tauriConfigPath,
      JSON.stringify(tauriConfig, null, 2),
      "utf8",
    );
    console.log(
      `[INFO]: tauri.conf.json version updated to: ${versionWithoutV}`,
    );
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
    const validTags = [
      "alpha",
      "beta",
      "rc",
      "autobuild",
      "autobuild-latest",
      "deploytest",
    ];

    if (validTags.includes(versionArg.toLowerCase())) {
      const currentVersion = await getCurrentVersion();
      const baseVersion = getBaseVersion(currentVersion);

      if (versionArg.toLowerCase() === "autobuild") {
        // 格式: 2.3.0-autobuild.0610.cc39b2.r2
        newVersion = `${baseVersion}-autobuild.${generateChannelSuffix({
          includeCommit: true,
          commitSource: "tauri",
        })}`;
      } else if (versionArg.toLowerCase() === "autobuild-latest") {
        // 格式: 2.3.0-autobuild.0610.a1b2c3d.r2 (使用最新 Tauri 提交)
        newVersion = `${baseVersion}-autobuild.${generateChannelSuffix({
          includeCommit: true,
          commitSource: "tauri",
        })}`;
      } else if (versionArg.toLowerCase() === "deploytest") {
        // 格式: 2.3.0-deploytest.0610.cc39b2.r2
        newVersion = `${baseVersion}-deploytest.${generateChannelSuffix({
          includeCommit: true,
          commitSource: "tauri",
        })}`;
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
