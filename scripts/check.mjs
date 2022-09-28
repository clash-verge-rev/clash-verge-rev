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
const NO_META = process.argv.includes("--no-meta") || false;

/**
 * get the correct clash release infomation
 */
function resolveClash() {
  const { platform, arch } = process;

  const CLASH_URL_PREFIX =
    "https://github.com/Dreamacro/clash/releases/download/premium/";
  const CLASH_LATEST_DATE = "2022.08.26";

  // todo
  const map = {
    "win32-x64": "clash-windows-amd64",
    "darwin-x64": "clash-darwin-amd64",
    "darwin-arm64": "clash-darwin-arm64",
    "linux-x64": "clash-linux-amd64",
    "linux-arm64": "clash-linux-armv8",
  };

  const name = map[`${platform}-${arch}`];

  if (!name) {
    throw new Error(`unsupport platform "${platform}-${arch}"`);
  }

  const isWin = platform === "win32";
  const zip = isWin ? "zip" : "gz";
  const url = `${CLASH_URL_PREFIX}${name}-${CLASH_LATEST_DATE}.${zip}`;
  const exefile = `${name}${isWin ? ".exe" : ""}`;
  const zipfile = `${name}.${zip}`;

  return { url, zip, exefile, zipfile };
}

/**
 * get the correct Clash.Meta release infomation
 */
async function resolveClashMeta() {
  const { platform, arch } = process;

  const urlPrefix = `https://github.com/MetaCubeX/Clash.Meta/releases/download/`;
  const latestVersion = "v1.13.1";

  const map = {
    "win32-x64": "Clash.Meta-windows-amd64",
    "darwin-x64": "Clash.Meta-darwin-amd64",
    "darwin-arm64": "Clash.Meta-darwin-arm64",
    "linux-x64": "Clash.Meta-linux-amd64-compatible",
    "linux-arm64": "Clash.Meta-linux-arm64",
  };

  const name = map[`${platform}-${arch}`];

  if (!name) {
    throw new Error(`unsupport platform "${platform}-${arch}"`);
  }

  const isWin = platform === "win32";
  const ext = isWin ? "zip" : "gz";
  const url = `${urlPrefix}${latestVersion}/${name}-${latestVersion}.${ext}`;
  const exefile = `${name}${isWin ? ".exe" : ""}`;
  const zipfile = `${name}-${latestVersion}.${ext}`;

  return { url, zip: ext, exefile, zipfile };
}

/**
 * get the sidecar bin
 * clash and Clash Meta
 */
async function resolveSidecar() {
  const sidecarDir = path.join(cwd, "src-tauri", "sidecar");

  const host = execSync("rustc -vV")
    .toString()
    .match(/(?<=host: ).+(?=\s*)/g)[0];

  const ext = process.platform === "win32" ? ".exe" : "";

  await clash();
  if (!NO_META) await clashMeta();

  async function clash() {
    const sidecarFile = `clash-${host}${ext}`;
    const sidecarPath = path.join(sidecarDir, sidecarFile);

    await fs.mkdirp(sidecarDir);
    if (!FORCE && (await fs.pathExists(sidecarPath))) return;

    // download sidecar
    const binInfo = resolveClash();
    const tempDir = path.join(TEMP_DIR, "clash");
    const tempZip = path.join(tempDir, binInfo.zipfile);
    const tempExe = path.join(tempDir, binInfo.exefile);

    await fs.mkdirp(tempDir);
    if (!(await fs.pathExists(tempZip)))
      await downloadFile(binInfo.url, tempZip);

    if (binInfo.zip === "zip") {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        console.log("[INFO]: entry name", entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      // save as sidecar
      await fs.rename(tempExe, sidecarPath);
      console.log(`[INFO]: unzip finished`);
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip);
      const writeStream = fs.createWriteStream(sidecarPath);
      readStream
        .pipe(zlib.createGunzip())
        .pipe(writeStream)
        .on("finish", () => {
          console.log(`[INFO]: gunzip finished`);
          execSync(`chmod 755 ${sidecarPath}`);
          console.log(`[INFO]: chmod binary finished`);
        })
        .on("error", (error) => console.error(error));
    }

    // delete temp dir
    await fs.remove(tempDir);
  }

  async function clashMeta() {
    const sidecarFile = `clash-meta-${host}${ext}`;
    const sidecarPath = path.join(sidecarDir, sidecarFile);

    await fs.mkdirp(sidecarDir);
    if (!FORCE && (await fs.pathExists(sidecarPath))) return;

    // download sidecar
    const binInfo = await resolveClashMeta();
    const tempDir = path.join(TEMP_DIR, "clash-meta");
    const tempZip = path.join(tempDir, binInfo.zipfile);
    const tempExe = path.join(tempDir, binInfo.exefile);

    await fs.mkdirp(tempDir);
    if (!(await fs.pathExists(tempZip)))
      await downloadFile(binInfo.url, tempZip);

    if (binInfo.zip === "zip") {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        console.log("[INFO]: entry name", entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      // save as sidecar
      await fs.rename(tempExe, sidecarPath);
      console.log(`[INFO]: unzip finished`);
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip);
      const writeStream = fs.createWriteStream(sidecarPath);
      readStream
        .pipe(zlib.createGunzip())
        .pipe(writeStream)
        .on("finish", () => {
          console.log(`[INFO]: gunzip finished`);
          execSync(`chmod 755 ${sidecarPath}`);
          console.log(`[INFO]: chmod binary finished`);
        })
        .on("error", (error) => console.error(error));
    }

    // delete temp dir
    await fs.remove(tempDir);
  }
}

/**
 * only Windows
 * get the wintun.dll (not required)
 */
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
 * only Windows
 * get the clash-verge-service.exe
 */
async function resolveService() {
  const { platform } = process;

  if (platform !== "win32") return;

  const resDir = path.join(cwd, "src-tauri/resources");

  const repo =
    "https://github.com/zzzgydi/clash-verge-service/releases/download/latest";

  async function help(bin) {
    const targetPath = path.join(resDir, bin);

    if (!FORCE && (await fs.pathExists(targetPath))) return;

    const url = `${repo}/${bin}`;
    await downloadFile(url, targetPath);
  }

  await fs.mkdirp(resDir);
  await help("clash-verge-service.exe");
  await help("install-service.exe");
  await help("uninstall-service.exe");

  console.log(`[INFO]: resolve Service finished`);
}

/**
 * get the Country.mmdb (not required)
 */
async function resolveMmdb() {
  const url =
    "https://github.com/Dreamacro/maxmind-geoip/releases/download/20220812/Country.mmdb";

  const resDir = path.join(cwd, "src-tauri", "resources");
  const resPath = path.join(resDir, "Country.mmdb");

  if (!FORCE && (await fs.pathExists(resPath))) return;

  await fs.mkdirp(resDir);
  await downloadFile(url, resPath);
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path) {
  console.log(`[INFO]: downloading from "${url}"`);

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

/// main
resolveSidecar().catch(console.error);
resolveWintun().catch(console.error);
resolveMmdb().catch(console.error);
resolveService().catch(console.error);
