import fs from "fs-extra";
import zlib from "zlib";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import proxyAgent from "https-proxy-agent";
import { execSync } from "child_process";

const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
const FORCE = process.argv.includes("--force");

const SIDECAR_HOST = execSync("rustc -vV")
  .toString()
  .match(/(?<=host: ).+(?=\s*)/g)[0];

/* ======= clash meta ======= */
const META_URL_PREFIX = `https://github.com/wonfen/Clash.Meta/releases/download/`;
const META_VERSION = "2023.11.23";

const META_MAP = {
  "win32-x64": "clash.meta-win-amd64",
  "darwin-x64": "clash.meta-darwin-amd64",
  "darwin-arm64": "clash.meta-darwin-arm64",
  "linux-x64": "clash.meta-linux-amd64",
  "linux-arm64": "clash.meta-linux-arm64",
};

const { platform, arch } = process;

if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta unsupported platform "${platform}-${arch}"`);
}

function getDownloadInfo(map, platform, arch, urlPrefix, latestDate) {
  const name = map[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${urlPrefix}${latestDate}/${name}-${latestDate}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${latestDate}.${urlExt}`;

  return {
    name,
    targetFile: `${name}-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

function clashMeta() {
  return getDownloadInfo(
    META_MAP,
    platform,
    arch,
    META_URL_PREFIX,
    META_VERSION
  );
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
      zip.extractAllTo(tempDir, true);
      await fs.rename(path.join(tempDir, exeFile), sidecarPath);
      console.log(`[INFO]: "${name}" unzip finished`);
    } else {
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
    await fs.remove(sidecarPath);
    throw err;
  } finally {
    await fs.remove(tempDir);
  }
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, filePath) {
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
  await fs.writeFile(filePath, new Uint8Array(buffer));

  console.log(`[INFO]: download finished "${url}"`);
}

const SERVICE_URL =
  "https://github.com/zzzgydi/clash-verge-service/releases/download/latest";

const tasks = [
  { name: "clash-meta", func: () => resolveSidecar(clashMeta()), retry: 5 },
];

async function runTask() {
  const task = tasks.shift();
  if (!task) return;

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
