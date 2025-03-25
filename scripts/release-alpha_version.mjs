import fs from "fs/promises";
import path from "path";
import { program } from "commander";

/**
 * 更新 package.json 文件中的版本号
 * @param {string} versionTag 版本标签 (如 "alpha", "beta", "rc")
 */
async function updatePackageVersion(versionTag) {
  const _dirname = process.cwd();
  const packageJsonPath = path.join(_dirname, "package.json");
  try {
    const data = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(data);

    // 获取当前版本并清理可能存在的旧标签
    let currentVersion = packageJson.version.replace(
      /-(alpha|beta|rc)\.?\d*$/i,
      "",
    );
    let newVersion = `${currentVersion}-${versionTag}`;

    console.log(
      "[INFO]: Current package.json version is: ",
      packageJson.version,
    );
    packageJson.version = newVersion;
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf8",
    );
    console.log(`[INFO]: package.json version updated to: ${newVersion}`);
    return newVersion;
  } catch (error) {
    console.error("Error updating package.json version:", error);
    throw error;
  }
}

/**
 * 更新 Cargo.toml 文件中的版本号
 * @param {string} versionTag 版本标签
 */
async function updateCargoVersion(versionTag) {
  const _dirname = process.cwd();
  const cargoTomlPath = path.join(_dirname, "src-tauri", "Cargo.toml");
  try {
    const data = await fs.readFile(cargoTomlPath, "utf8");
    const lines = data.split("\n");

    const updatedLines = lines.map((line) => {
      if (line.trim().startsWith("version =")) {
        // 清理可能存在的旧标签
        const cleanedVersion = line.replace(/-(alpha|beta|rc)\.?\d*"/i, '"');
        const versionMatch = cleanedVersion.match(/version\s*=\s*"([^"]+)"/);
        if (versionMatch) {
          const newVersion = `${versionMatch[1]}-${versionTag}`;
          return line.replace(versionMatch[1], newVersion);
        }
      }
      return line;
    });

    await fs.writeFile(cargoTomlPath, updatedLines.join("\n"), "utf8");
    console.log(`[INFO]: Cargo.toml version updated with ${versionTag} tag`);
  } catch (error) {
    console.error("Error updating Cargo.toml version:", error);
    throw error;
  }
}

/**
 * 更新 tauri.conf.json 文件中的版本号
 * @param {string} versionTag 版本标签
 */
async function updateTauriConfigVersion(versionTag) {
  const _dirname = process.cwd();
  const tauriConfigPath = path.join(_dirname, "src-tauri", "tauri.conf.json");
  try {
    const data = await fs.readFile(tauriConfigPath, "utf8");
    const tauriConfig = JSON.parse(data);

    // 清理可能存在的旧标签
    let currentVersion = tauriConfig.version.replace(
      /-(alpha|beta|rc)\.?\d*$/i,
      "",
    );
    let newVersion = `${currentVersion}-${versionTag}`;

    console.log(
      "[INFO]: Current tauri.conf.json version is: ",
      tauriConfig.version,
    );
    tauriConfig.version = newVersion;
    await fs.writeFile(
      tauriConfigPath,
      JSON.stringify(tauriConfig, null, 2),
      "utf8",
    );
    console.log(`[INFO]: tauri.conf.json version updated to: ${newVersion}`);
  } catch (error) {
    console.error("Error updating tauri.conf.json version:", error);
    throw error;
  }
}

/**
 * 主函数，依次更新所有文件的版本号
 * @param {string} versionTag 版本标签
 */
async function main(versionTag) {
  if (!versionTag) {
    console.error("Error: Version tag is required");
    process.exit(1);
  }

  // 验证版本标签是否有效
  const validTags = ["alpha", "beta", "rc"];
  if (!validTags.includes(versionTag.toLowerCase())) {
    console.error(
      `Error: Invalid version tag. Must be one of: ${validTags.join(", ")}`,
    );
    process.exit(1);
  }

  try {
    console.log(`[INFO]: Updating versions with ${versionTag} tag...`);
    await updatePackageVersion(versionTag);
    await updateCargoVersion(versionTag);
    await updateTauriConfigVersion(versionTag);
    console.log("[SUCCESS]: All version updates completed successfully!");
  } catch (error) {
    console.error("[ERROR]: Failed to update versions:", error);
    process.exit(1);
  }
}

// 设置命令行界面
program
  .name("pnpm release-version")
  .description("Add version tag (alpha/beta/rc) to project version numbers")
  .argument("<version-tag>", "version tag to add (alpha, beta, or rc)")
  .action(main)
  .parse(process.argv);
