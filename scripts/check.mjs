import fs from "fs-extra";
import zlib from "zlib";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import proxyAgent from "https-proxy-agent";
import { exec, execSync } from "child_process";

const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
const FORCE = process.argv.includes("--force");

const SIDECAR_HOST = execSync("rustc -vV")
  .toString()
  .match(/(?<=host: ).+(?=\s*)/g)[0];

const META_URL_PREFIX = `https://github.com/wonfen/Clash.Meta/releases/download/`;
const META_VERSION = "2023.11.23";

const META_MAP = {
  "win32-x64": "clash.meta-win-amd64",
  "darwin-x64": "clash.meta-darwin-amd64",
  "darwin-arm64": "clash.meta-darwin-arm64",
  "linux-x64": "clash.meta-linux-amd64",
  "linux-arm64": "clash.meta-linux-arm64",
};

function clashMeta() {
  const name = META_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${META_URL_PREFIX}${META_VERSION}/${name}-${META_VERSION}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${META_VERSION}.${urlExt}`;

  return {
    name: "clash-meta",
    targetFile: `clash-meta-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

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

  if (!response.ok) {
    throw new Error(`Download failed for "${url}" with status ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(path, new Uint8Array(buffer));

  console.log(`[INFO]: download finished "${url}"`);
}

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
            exec(`chmod 755 ${sidecarPath}`, (err) => {
              if (err) {
                console.error(`[ERROR]: "${name}" chmod binary failed:`, err);
                reject(err);
              } else {
                console.log(`[INFO]: "${name}" chmod binary finished`);
                resolve();
              }
            });
          })
          .on("error", onError);
      });
    }
  } catch (err) {
    await fs.remove(sidecarPath);
    throw err;
  } finally {
    await fs.remove(tempDir);
  }
}

async function resolveClash() {
  try {
    return await resolveSidecar(clash());
  } catch {
    console.log(`[WARN]: clash core needs to be updated`);
    return await resolveSidecar(clashS3());
  }
}

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
  { name: "clash", func: resolveClash, retry: 5 },
  { name: "clash-meta", func: () => resolveSidecar(clashMeta()), retry: 5 },
  { name: "wintun", func: resolveWintun, retry: 5, winOnly: true },
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
