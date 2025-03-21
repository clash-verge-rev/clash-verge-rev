import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

/**
 *  为Alpha版本重命名版本号
 */
const execPromise = promisify(exec);

/**
 * 标准输出HEAD hash
 */
async function getLatestCommitHash() {
  try {
    const { stdout } = await execPromise("git rev-parse HEAD");
    const commitHash = stdout.trim();
    // 格式化，只截取前7位字符
    const formathash = commitHash.substring(0, 7);
    console.log(`Found the latest commit hash code: ${commitHash}`);
    return formathash;
  } catch (error) {
    console.error("pnpm run fix-alpha-version ERROR", error);
  }
}

/**
 * @param string 传入格式化后的hash
 * 将新的版本号写入文件 package.json
 */
async function updatePackageVersion(newVersion) {
  // 获取内容根目录
  const _dirname = process.cwd();
  const packageJsonPath = path.join(_dirname, "package.json");
  try {
    // 读取文件
    const data = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(data);
    // 获取键值替换
    let result = packageJson.version.replace("alpha", newVersion);
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

const newVersion = await getLatestCommitHash();
updatePackageVersion(newVersion).catch(console.error);
