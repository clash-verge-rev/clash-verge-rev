import fs from "fs-extra";
import zlib from "zlib";
import tar from "tar";
import path from "path";
import AdmZip from "adm-zip";
import { execSync } from "child_process";
import {
  PLATFORM_MAP,
  ARCH_MAP,
  META_ALPHA_MAP,
  META_MAP,
} from "./check-variables.mjs";

const cwd = process.cwd();
const STORE_DIR = path.join(cwd, "offline-dependencies");
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
const FORCE = process.argv.includes("--force");

const arg1 = process.argv.slice(2)[0];
const arg2 = process.argv.slice(2)[1];
const target = arg1 === "--force" ? arg2 : arg1;
const { platform, arch } = target
  ? { platform: PLATFORM_MAP[target], arch: ARCH_MAP[target] }
  : process;

const SIDECAR_HOST = target
  ? target
  : execSync("rustc -vV")
      .toString()
      .match(/(?<=host: ).+(?=\s*)/g)[0];

/*
 * check available
 */
if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(
    `clash meta alpha unsupported platform "${platform}-${arch}"`
  );
}

if (!META_ALPHA_MAP[`${platform}-${arch}`]) {
  throw new Error(
    `clash meta alpha unsupported platform "${platform}-${arch}"`
  );
}

/**
 * core info
 */
function clashMetaAlpha() {
  const dir = path.join(STORE_DIR, "sidecar/clash-meta-alpha");
  const versionFile = path.join(dir, "version.txt");
  let version;
  try {
    version = fs.readFileSync(versionFile).toString().trim(); // Trim to remove extra whitespaces
    console.log(`Latest alpha version: ${version}`);
  } catch (error) {
    console.error("Error fetching latest alpha version:", error.message);
    process.exit(1);
  }
  const name = META_ALPHA_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${version}.${urlExt}`;

  return {
    name: "clash-meta-alpha",
    targetFile: `clash-meta-alpha-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    srcPath: path.join(dir, zipFile),
  };
}

function clashMeta() {
  const dir = path.join(STORE_DIR, "sidecar/clash-meta");
  const versionFile = path.join(dir, "version.txt");
  let version;
  try {
    version = fs.readFileSync(versionFile).toString().trim(); // Trim to remove extra whitespaces
    console.log(`Latest alpha version: ${version}`);
  } catch (error) {
    console.error("Error fetching latest alpha version:", error.message);
    process.exit(1);
  }
  const name = META_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${version}.${urlExt}`;

  return {
    name: "clash-meta",
    targetFile: `clash-meta-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    srcPath: path.join(dir, zipFile),
  };
}
/**
 * download sidecar and rename
 */
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, srcPath } = binInfo;

  const sidecarDir = path.join(cwd, "src-tauri", "sidecar");
  const sidecarPath = path.join(sidecarDir, targetFile);

  await fs.mkdirp(sidecarDir);
  if (!FORCE && (await fs.pathExists(sidecarPath))) return;

  const tempDir = path.join(TEMP_DIR, name);
  const tempZip = path.join(tempDir, zipFile);
  const tempExe = path.join(tempDir, exeFile);

  await fs.mkdirp(tempDir);
  try {
    if (!(await fs.pathExists(tempZip))) {
      fs.copyFileSync(srcPath, tempZip);
    }

    if (zipFile.endsWith(".zip")) {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        console.log(`[DEBUG]: "${name}" entry name`, entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      await fs.rename(tempExe, sidecarPath);
      console.log(`[INFO]: "${name}" unzip finished`);
    } else if (zipFile.endsWith(".tgz")) {
      // tgz
      await fs.mkdirp(tempDir);
      await tar.extract({
        cwd: tempDir,
        file: tempZip,
        //strip: 1, // 可能需要根据实际的 .tgz 文件结构调整
      });
      const files = await fs.readdir(tempDir);
      console.log(`[DEBUG]: "${name}" files in tempDir:`, files);
      const extractedFile = files.find((file) => file.startsWith("虚空终端-"));
      if (extractedFile) {
        const extractedFilePath = path.join(tempDir, extractedFile);
        await fs.rename(extractedFilePath, sidecarPath);
        console.log(`[INFO]: "${name}" file renamed to "${sidecarPath}"`);
        execSync(`chmod 755 ${sidecarPath}`);
        console.log(`[INFO]: "${name}" chmod binary finished`);
      } else {
        throw new Error(`Expected file not found in ${tempDir}`);
      }
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip);
      const writeStream = fs.createWriteStream(sidecarPath);
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          console.error(`[ERROR]: "${name}" gz failed:`, error.message);
          reject(error);
        };
        readStream
          .pipe(zlib.createGunzip().on("error", onError))
          .pipe(writeStream)
          .on("finish", () => {
            console.log(`[INFO]: "${name}" gunzip finished`);
            execSync(`chmod 755 ${sidecarPath}`);
            console.log(`[INFO]: "${name}" chmod binary finished`);
            resolve();
          })
          .on("error", onError);
      });
    }
  } catch (err) {
    // 需要删除文件
    await fs.remove(sidecarPath);
    throw err;
  } finally {
    // delete temp dir
    await fs.remove(tempDir);
  }
}

/**
 * download the file to the resources dir
 */
async function resolveResource(binInfo) {
  const { file, srcPath } = binInfo;

  const resDir = path.join(cwd, "src-tauri/resources");
  const targetPath = path.join(resDir, file);

  if (!FORCE && fs.pathExistsSync(targetPath)) return;

  fs.mkdirpSync(resDir);
  fs.copyFileSync(srcPath, targetPath);

  console.log(`[INFO]: ${file} finished`);
}

// SimpleSC.dll
const resolvePlugin = async () => {
  const name = "NSIS_Simple_Service_Plugin_Unicode_1.30.zip";

  const tempDir = path.join(TEMP_DIR, "SimpleSC");
  const tempZip = path.join(tempDir, name);
  const tempDll = path.join(tempDir, "SimpleSC.dll");
  const pluginDir = path.join(process.env.APPDATA, "Local/NSIS");
  const pluginPath = path.join(pluginDir, "SimpleSC.dll");
  fs.mkdirpSync(pluginDir);
  fs.mkdirpSync(tempDir);
  if (!FORCE && fs.pathExistsSync(pluginPath)) return;
  try {
    if (!fs.pathExistsSync(tempZip)) {
      fs.copyFileSync(path.join(STORE_DIR, name), tempZip);
    }
    const zip = new AdmZip(tempZip);
    zip.getEntries().forEach((entry) => {
      console.log(`[DEBUG]: "SimpleSC" entry name`, entry.entryName);
    });
    zip.extractAllTo(tempDir, true);
    fs.copyFileSync(tempDll, pluginPath);
    console.log(`[INFO]: "SimpleSC" unzip finished`, pluginDir);
  } finally {
    fs.removeSync(tempDir);
  }
};

const serviceExecutables = [
  "clash-verge-service",
  "install-service",
  "uninstall-service",
];
// service chmod
const resolveServicePermission = async () => {
  const resDir = path.join(cwd, "src-tauri/resources");
  for (let f of serviceExecutables) {
    const targetPath = path.join(resDir, f);
    if (await fs.pathExists(targetPath)) {
      execSync(`chmod 755 ${targetPath}`);
      console.log(`[INFO]: "${targetPath}" chmod finished`);
    }
  }
};

/**
 * main
 */
const resolveClashVergeService = (name) => {
  let ext = platform === "win32" ? ".exe" : "";
  name = name + ext;
  resolveResource({
    file: name,
    srcPath: path.join(STORE_DIR, "clash-verge-service", SIDECAR_HOST, name),
  });
};

const resolveSetDnsScript = () =>
  resolveResource({
    file: "set_dns.sh",
    srcPath: path.join(STORE_DIR, "set-dns-script", "set_dns.sh"),
  });
const resolveUnSetDnsScript = () =>
  resolveResource({
    file: "unset_dns.sh",
    srcPath: path.join(STORE_DIR, "set-dns-script", "unset_dns.sh"),
  });
const resolveMmdb = () =>
  resolveResource({
    file: "Country.mmdb",
    srcPath: path.join(STORE_DIR, "meta-rules-dat", "Country.mmdb"),
  });
const resolveGeosite = () =>
  resolveResource({
    file: "geosite.dat",
    srcPath: path.join(STORE_DIR, "meta-rules-dat", "geosite.dat"),
  });
const resolveGeoIP = () =>
  resolveResource({
    file: "geoip.dat",
    srcPath: path.join(STORE_DIR, "meta-rules-dat", "geoip.dat"),
  });
const resolveEnableLoopback = () =>
  resolveResource({
    file: "enableLoopback.exe",
    srcPath: path.join(STORE_DIR, "uwp-tool", "enableLoopback.exe"),
  });

const tasks = [
  {
    name: "clash-meta-alpha",
    func: () => resolveSidecar(clashMetaAlpha()),
  },
  {
    name: "clash-meta",
    func: () => resolveSidecar(clashMeta()),
  },
  { name: "plugin", func: resolvePlugin, winOnly: true },
  ...serviceExecutables.map((name) => ({
    name: "service",
    func: () => resolveClashVergeService(name),
  })),
  { name: "set_dns_script", func: resolveSetDnsScript, retry: 5 },
  { name: "unset_dns_script", func: resolveUnSetDnsScript, retry: 5 },
  { name: "mmdb", func: resolveMmdb, retry: 5 },
  { name: "geosite", func: resolveGeosite, retry: 5 },
  { name: "geoip", func: resolveGeoIP, retry: 5 },
  {
    name: "enableLoopback",
    func: resolveEnableLoopback,
    winOnly: true,
  },
  {
    name: "service_chmod",
    func: resolveServicePermission,
    unixOnly: true,
  },
];

async function runTask() {
  const task = tasks.shift();
  if (!task) return;
  if (task.winOnly && platform !== "win32") return runTask();
  if (task.linuxOnly && platform !== "linux") return runTask();
  if (task.unixOnly && platform === "win32") return runTask();

  try {
    await task.func();
  } catch (err) {
    console.error(`[ERROR]: task::${task.name}`, err.message);
    throw err;
  }
  return runTask();
}

runTask();
runTask();
