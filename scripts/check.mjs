import fs from "fs-extra";
import zlib from "zlib";
import tar from "tar";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import proxyAgent from "https-proxy-agent";
import { execSync } from "child_process";

const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
const FORCE = process.argv.includes("--force");

/* ======= clash ======= 
const CLASH_STORAGE_PREFIX = "https://release.dreamacro.workers.dev/";
const CLASH_URL_PREFIX =
  "https://github.com/Dreamacro/clash/releases/download/premium/";
const CLASH_LATEST_DATE = "latest";

const CLASH_BACKUP_URL_PREFIX =
  "https://github.com/zhongfly/Clash-premium-backup/releases/download/";
const CLASH_BACKUP_LATEST_DATE = "2023-09-05-gdcc8d87";

//https://github.com/zhongfly/Clash-premium-backup/releases/download/2023-09-05-gdcc8d87/clash-windows-amd64-2023-09-05-gdcc8d87.zip
//https://github.com/zhongfly/Clash-premium-backup/releases/download/2023-09-05-gdcc8d87/clash-windows-amd64-n2023-09-05-gdcc8d87.zip

const CLASH_MAP = {
  "win32-x64": "clash-windows-amd64",
  "darwin-x64": "clash-darwin-amd64",
  "darwin-arm64": "clash-darwin-arm64",
  "linux-x64": "clash-linux-amd64",
  "linux-arm64": "clash-linux-arm64",
};
*/
/* ======= clash meta ======= */
const META_URL_PREFIX = `https://github.com/wonfen/Clash.Meta/releases/download/latest`;
// const META_VERSION = "2023.11.23";

const META_MAP = {
  "win32-x64": "clash.meta-win-amd64",
  "win32-arm64": "clash.meta-win-arm64",
  "darwin-x64": "clash.meta-darwin-amd64",
  "darwin-arm64": "clash.meta-darwin-arm64",
  "linux-x64": "clash.meta-linux-amd64",
  "linux-arm64": "clash.meta-linux-arm64",
};

/*
 * check available
 */
const PLATFORM_MAP = {
  "x86_64-pc-windows-msvc": "win32",
  "aarch64-pc-windows-msvc": "win32",
  "x86_64-apple-darwin": "darwin",
  "aarch64-apple-darwin": "darwin",
  "x86_64-unknown-linux-gnu": "linux",
  "aarch64-unknown-linux-gnu": "linux",
};
const ARCH_MAP = {
  "x86_64-pc-windows-msvc": "x64",
  "aarch64-pc-windows-msvc": "arm64",
  "x86_64-apple-darwin": "x64",
  "aarch64-apple-darwin": "arm64",
  "x86_64-unknown-linux-gnu": "x64",
  "aarch64-unknown-linux-gnu": "arm64",
};

const target = process.argv.slice(2)[0];
const { platform, arch } = target
  ? { platform: PLATFORM_MAP[target], arch: ARCH_MAP[target] }
  : process;

const SIDECAR_HOST = target
  ? target
  : execSync("rustc -vV")
      .toString()
      .match(/(?<=host: ).+(?=\s*)/g)[0];
/*
if (!CLASH_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash unsupported platform "${platform}-${arch}"`);
}
*/
if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta unsupported platform "${platform}-${arch}"`);
}
/*
function clash() {
  const name = CLASH_MAP[`${platform}-${arch}`];

  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${CLASH_URL_PREFIX}${name}-${CLASH_LATEST_DATE}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}.${urlExt}`;

  return {
    name: "clash",
    targetFile: `clash-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

function clashBackup() {
  const name = CLASH_MAP[`${platform}-${arch}`];

  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${CLASH_BACKUP_URL_PREFIX}${CLASH_BACKUP_LATEST_DATE}/${name}-n${CLASH_BACKUP_LATEST_DATE}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}.${urlExt}`;

  return {
    name: "clash",
    targetFile: `clash-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

function clashS3() {
  const name = CLASH_MAP[`${platform}-${arch}`];

  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${CLASH_STORAGE_PREFIX}${CLASH_LATEST_DATE}/${name}-${CLASH_LATEST_DATE}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}.${urlExt}`;

  return {
    name: "clash",
    targetFile: `clash-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}
*/
function clashMeta() {
  const name = META_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  /*   const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${META_URL_PREFIX}${META_VERSION}/${name}-${META_VERSION}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${META_VERSION}.${urlExt}`; */
  const urlExt = isWin ? "zip" : "tgz";
  const downloadURL = `${META_URL_PREFIX}/${name}.${urlExt}`;
  const exeFile = isWin ? "虚空终端-win-amd64.exe" : name;
  const zipFile = `${name}.${urlExt}`;

  return {
    name: "clash-meta",
    targetFile: `clash-meta-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

/**
 * download sidecar and rename
 */
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, downloadURL } = binInfo;

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
      await downloadFile(downloadURL, tempZip);
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
 * prepare clash core
 * if the core version is not updated in time, use S3 storage as a backup.
 */
async function resolveClash() {
  try {
    return await resolveSidecar(clash());
  } catch {
    console.log(`[WARN]: clash core needs to be updated`);
    return await resolveSidecar(clashS3());
  }
}

/**
 * only Windows
 * get the wintun.dll (not required)

async function resolveWintun() {
  const { platform } = process;

  if (platform !== "win32") return;

  const url = "https://www.wintun.net/builds/wintun-0.14.1.zip";

  const tempDir = path.join(TEMP_DIR, "wintun");
  const tempZip = path.join(tempDir, "wintun.zip");

  const wintunPath = path.join(tempDir, "wintun/bin/amd64/wintun.dll");
  const targetPath = path.join(cwd, "src-tauri/resources", "wintun.dll");

  if (!FORCE && (await fs.pathExists(targetPath))) return;

  await fs.mkdirp(tempDir);

  if (!(await fs.pathExists(tempZip))) {
    await downloadFile(url, tempZip);
  }

  // unzip
  const zip = new AdmZip(tempZip);
  zip.extractAllTo(tempDir, true);

  if (!(await fs.pathExists(wintunPath))) {
    throw new Error(`path not found "${wintunPath}"`);
  }

  await fs.rename(wintunPath, targetPath);
  await fs.remove(tempDir);

  console.log(`[INFO]: resolve wintun.dll finished`);
}
*/
/**
 * download the file to the resources dir
 */
async function resolveResource(binInfo) {
  const { file, downloadURL } = binInfo;

  const resDir = path.join(cwd, "src-tauri/resources");
  const targetPath = path.join(resDir, file);

  if (!FORCE && (await fs.pathExists(targetPath))) return;

  await fs.mkdirp(resDir);
  await downloadFile(downloadURL, targetPath);

  console.log(`[INFO]: ${file} finished`);
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path) {
  const options = {};

  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;

  if (httpProxy) {
    options.agent = proxyAgent(httpProxy);
  }

  const response = await fetch(url, {
    ...options,
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });
  const buffer = await response.arrayBuffer();
  await fs.writeFile(path, new Uint8Array(buffer));

  console.log(`[INFO]: download finished "${url}"`);
}

/**
 * main
 */
const SERVICE_URL =
  "https://github.com/zzzgydi/clash-verge-service/releases/download/latest";

const resolveService = () =>
  resolveResource({
    file: "clash-verge-service.exe",
    downloadURL: `${SERVICE_URL}/clash-verge-service.exe`,
  });
const resolveInstall = () =>
  resolveResource({
    file: "install-service.exe",
    downloadURL: `${SERVICE_URL}/install-service.exe`,
  });
const resolveUninstall = () =>
  resolveResource({
    file: "uninstall-service.exe",
    downloadURL: `${SERVICE_URL}/uninstall-service.exe`,
  });
const resolveMmdb = () =>
  resolveResource({
    file: "Country.mmdb",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb`,
  });
const resolveGeosite = () =>
  resolveResource({
    file: "geosite.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`,
  });
const resolveGeoIP = () =>
  resolveResource({
    file: "geoip.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`,
  });
const resolveEnableLoopback = () =>
  resolveResource({
    file: "enableLoopback.exe",
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`,
  });

const tasks = [
  // { name: "clash", func: resolveClash, retry: 5 },
  { name: "clash-meta", func: () => resolveSidecar(clashMeta()), retry: 5 },
  // { name: "wintun", func: resolveWintun, retry: 5, winOnly: true },
  { name: "service", func: resolveService, retry: 5, winOnly: true },
  { name: "install", func: resolveInstall, retry: 5, winOnly: true },
  { name: "uninstall", func: resolveUninstall, retry: 5, winOnly: true },
  { name: "mmdb", func: resolveMmdb, retry: 5 },
  { name: "geosite", func: resolveGeosite, retry: 5 },
  { name: "geoip", func: resolveGeoIP, retry: 5 },
  {
    name: "enableLoopback",
    func: resolveEnableLoopback,
    retry: 5,
    winOnly: true,
  },
];

async function runTask() {
  const task = tasks.shift();
  if (!task) return;
  if (task.winOnly && process.platform !== "win32") return runTask();

  for (let i = 0; i < task.retry; i++) {
    try {
      await task.func();
      break;
    } catch (err) {
      console.error(`[ERROR]: task::${task.name} try ${i} ==`, err.message);
      if (i === task.retry - 1) throw err;
    }
  }
  return runTask();
}

runTask();
runTask();
