import fs from "fs/promises";
import path from "path";

/**
 * @param string 传入格式化后的hash
 * 将新的版本号写入文件 package.json
 */
async function updatePackageVersion() {
  // 获取内容根目录
  const _dirname = process.cwd();
  const packageJsonPath = path.join(_dirname, "package.json");
  try {
    // 读取文件
    const data = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(data);

    let result = packageJson.version;
    const newVersion = result;

    // Check if version includes 'alpha'
    if (!result.includes("alpha")) {
      // If not, append -alpha to the version
      result = `${result}-alpha`;
    }

    console.log("[INFO]: Current version is: ", result);
    packageJson.version = result;
    // 写入版本号
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf8",
    );
    console.log(`[INFO]: Alpha version update to: ${newVersion}`);
  } catch (error) {
    console.error("pnpm run fix-alpha-version ERROR", error);
  }
}

updatePackageVersion().catch(console.error);
