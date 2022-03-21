import fs from "fs-extra";
import zlib from "zlib";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import { execSync } from "child_process";

const cwd = process.cwd();
const FORCE = process.argv.includes("--force");

/**
 * get the correct clash release infomation
 */
function resolveClash() {
  const { platform, arch } = process;

  const CLASH_URL_PREFIX =
    "https://github.com/Dreamacro/clash/releases/download/premium/";
  const CLASH_LATEST_DATE = "2022.03.21";

  // todo
  const map = {
    "win32-x64": "clash-windows-amd64",
    "darwin-x64": "clash-darwin-amd64",
    "darwin-arm64": "clash-darwin-arm64",
    "linux-x64": "clash-linux-amd64",
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
 * get the sidecar bin
 */
async function resolveSidecar() {
  const sidecarDir = path.join(cwd, "src-tauri", "sidecar");

  const host = execSync("rustc -vV | grep host").toString().slice(6).trim();
  const ext = process.platform === "win32" ? ".exe" : "";
  const sidecarFile = `clash-${host}${ext}`;
  const sidecarPath = path.join(sidecarDir, sidecarFile);

  await fs.mkdirp(sidecarDir);
  if (!FORCE && (await fs.pathExists(sidecarPath))) return;

  // download sidecar
  const binInfo = resolveClash();
  const tempDir = path.join(cwd, "pre-dev-temp");
  const tempZip = path.join(tempDir, binInfo.zipfile);
  const tempExe = path.join(tempDir, binInfo.exefile);

  await fs.mkdirp(tempDir);
  if (!(await fs.pathExists(tempZip))) await downloadFile(binInfo.url, tempZip);

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

/**
 * only Windows
 * get the wintun.dll (not required)
 */
async function resolveWintun() {
  const { platform } = process;

  if (platform !== "win32") return;

  const url = "https://www.wintun.net/builds/wintun-0.14.1.zip";

  const tempDir = path.join(cwd, "pre-dev-temp-1");
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

  // move wintun.dll to resources
  await fs.rename(wintunPath, targetPath);
  // delete temp dir
  await fs.remove(tempDir);

  console.log(`[INFO]: resolve wintun.dll finished`);
}

/**
 * get the Country.mmdb (not required)
 */
async function resolveMmdb() {
  const url =
    "https://github.com/Dreamacro/maxmind-geoip/releases/latest/download/Country.mmdb";

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

  const response = await fetch(url, {
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
