import fs from "node:fs/promises";
import path from "node:path";

/**
 * 更新 package.json 文件中的版本号
 */
async function updatePackageVersion() {
  const _dirname = process.cwd();
  const packageJsonPath = path.join(_dirname, "package.json");
  try {
    const data = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(data);

    let result = packageJson.version;
    if (!result.includes("alpha")) {
      result = `${result}-alpha`;
    }

    console.log("[INFO]: Current package.json version is: ", result);
    packageJson.version = result;
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf8",
    );
    console.log(`[INFO]: package.json version updated to: ${result}`);
  } catch (error) {
    console.error("Error updating package.json version:", error);
  }
}

/**
 * 更新 Cargo.toml 文件中的版本号
 */
async function updateCargoVersion() {
  const _dirname = process.cwd();
  const cargoTomlPath = path.join(_dirname, "src-tauri", "Cargo.toml");
  try {
    const data = await fs.readFile(cargoTomlPath, "utf8");
    const lines = data.split("\n");

    const updatedLines = lines.map((line) => {
      if (line.startsWith("version =")) {
        const versionMatch = line.match(/version\s*=\s*"([^"]+)"/);
        if (versionMatch && !versionMatch[1].includes("alpha")) {
          const newVersion = `${versionMatch[1]}-alpha`;
          return line.replace(versionMatch[1], newVersion);
        }
      }
      return line;
    });

    await fs.writeFile(cargoTomlPath, updatedLines.join("\n"), "utf8");
  } catch (error) {
    console.error("Error updating Cargo.toml version:", error);
  }
}

/**
 * 更新 tauri.conf.json 文件中的版本号
 */
async function updateTauriConfigVersion() {
  const _dirname = process.cwd();
  const tauriConfigPath = path.join(_dirname, "src-tauri", "tauri.conf.json");
  try {
    const data = await fs.readFile(tauriConfigPath, "utf8");
    const tauriConfig = JSON.parse(data);

    let version = tauriConfig.version;
    if (!version.includes("alpha")) {
      version = `${version}-alpha`;
    }

    console.log("[INFO]: Current tauri.conf.json version is: ", version);
    tauriConfig.version = version;
    await fs.writeFile(
      tauriConfigPath,
      JSON.stringify(tauriConfig, null, 2),
      "utf8",
    );
    console.log(`[INFO]: tauri.conf.json version updated to: ${version}`);
  } catch (error) {
    console.error("Error updating tauri.conf.json version:", error);
  }
}

/**
 * 主函数，依次更新所有文件的版本号
 */
async function main() {
  await updatePackageVersion();
  await updateCargoVersion();
  await updateTauriConfigVersion();
}

main().catch(console.error);
