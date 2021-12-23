import fs from "fs-extra";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import { execSync } from "child_process";

const cwd = process.cwd();

const CLASH_URL_PREFIX =
  "https://github.com/Dreamacro/clash/releases/download/premium/";
const CLASH_LATEST_DATE = "2021.12.07";

/**
 * get the correct clash release infomation
 */
function resolveClash() {
  const { platform, arch } = process;

  let name = "";

  // todo
  if (platform === "win32" && arch === "x64") {
    name = `clash-windows-386`;
  }

  if (!name) {
    throw new Error("todo");
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

  // Todo: support gz
  const zip = new AdmZip(tempZip);
  zip.getEntries().forEach((entry) => {
    console.log("[INFO]: entry name", entry.entryName);
  });
  zip.extractAllTo(tempDir, true);

  // save as sidecar
  await fs.rename(tempExe, sidecarPath);

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
}

/// main
resolveSidecar();
resolveMmdb();
