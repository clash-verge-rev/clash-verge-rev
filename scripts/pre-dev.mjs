import fs from "fs-extra";
import zlib from "zlib";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import { execSync } from "child_process";

const cwd = process.cwd();

const CLASH_URL_PREFIX =
  "https://github.com/Dreamacro/clash/releases/download/premium/";
const CLASH_LATEST_DATE = "2022.01.03";

/**
 * get the correct clash release infomation
 */
function resolveClash() {
  const { platform, arch } = process;

  // todo
  const map = {
    "win32-x64": "clash-windows-386",
    "darwin-x64": "clash-darwin-amd64",
    "darwin-arm64": "clash-darwin-arm64",
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

  if (!(await fs.pathExists(sidecarDir))) await fs.mkdir(sidecarDir);
  if (await fs.pathExists(sidecarPath)) return;

  // download sidecar
  const binInfo = resolveClash();
  const tempDir = path.join(cwd, "pre-dev-temp");
  const tempZip = path.join(tempDir, binInfo.zipfile);
  const tempExe = path.join(tempDir, binInfo.exefile);

  if (!(await fs.pathExists(tempDir))) await fs.mkdir(tempDir);
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
      });
  }

  // delete temp dir
  await fs.remove(tempDir);
}

/**
 * get the Country.mmdb (not required)
 */
async function resolveMmdb() {
  const url =
    "https://github.com/Dreamacro/maxmind-geoip/releases/latest/download/Country.mmdb";

  const resPath = path.join(cwd, "src-tauri", "resources", "Country.mmdb");
  if (await fs.pathExists(resPath)) return;
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
resolveSidecar();
resolveMmdb();
