import fs from "node:fs/promises";
import path from "node:path";
import { program } from "npm:commander";

/**
 * 验证版本号格式
 * @param {string} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  return /^v?\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?$/i.test(version);
}

/**
 * 标准化版本号（确保v前缀可选）
 * @param {string} version
 * @returns {string}
 */
function normalizeVersion(version) {
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * 更新 package.json 文件中的版本号
 * @param {string} newVersion 新版本号
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
    return packageJson.version;
  } catch (error) {
    console.error("Error updating package.json version:", error);
    throw error;
  }
}

/**
 * 更新 Cargo.toml 文件中的版本号
 * @param {string} newVersion 新版本号
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
 * 更新 tauri.conf.json 文件中的版本号
 * @param {string} newVersion 新版本号
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
 * 获取当前版本号（从package.json）
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
 * 主函数，更新所有文件的版本号
 * @param {string} versionArg 版本参数（可以是标签或完整版本号）
 */
async function main(versionArg) {
  if (!versionArg) {
    console.error("Error: Version argument is required");
    process.exit(1);
  }

  try {
    let newVersion;
    const validTags = ["alpha", "beta", "rc"];

    // 判断参数是标签还是完整版本号
    if (validTags.includes(versionArg.toLowerCase())) {
      // 标签模式：在当前版本基础上添加标签
      const currentVersion = await getCurrentVersion();
      const baseVersion = currentVersion.replace(
        /-(alpha|beta|rc)(\.\d+)?$/i,
        "",
      );
      newVersion = `${baseVersion}-${versionArg.toLowerCase()}`;
    } else {
      // 完整版本号模式
      if (!isValidVersion(versionArg)) {
        console.error(
          "Error: Invalid version format. Expected format: vX.X.X or vX.X.X-tag (e.g. v2.2.3 or v2.2.3-alpha)",
        );
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

// Example:
// pnpm release-version 2.2.3-alpha
// 设置命令行界面
program
  .name("pnpm release-version")
  .description(
    "Update project version numbers. Can add tag (alpha/beta/rc) or set full version (e.g. v2.2.3 or v2.2.3-alpha)",
  )
  .argument(
    "<version>",
    "version tag (alpha/beta/rc) or full version (e.g. v2.2.3 or v2.2.3-alpha)",
  )
  .action(main)
  .parse(process.argv);
