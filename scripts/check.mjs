import AdmZip from "adm-zip";
import { execSync } from "child_process";
import clc from "cli-color";
import fs from "fs-extra";
import proxyAgent from "https-proxy-agent";
import fetch from "node-fetch";
import path from "path";
import * as tar from "tar";
import zlib from "zlib";

const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
let process_argvs = process.argv;
const FORCE = process_argvs.includes("--force");
const useAlphaService = process_argvs.includes("--alpha");
if (useAlphaService) {
  process_argvs = process_argvs.filter((item) => item !== "--alpha");
}

// log
const log_success = (msg, ...optionalParams) =>
  console.log(clc.green(msg), ...optionalParams);
const log_error = (msg, ...optionalParams) =>
  console.log(clc.red(msg), ...optionalParams);
const log_info = (msg, ...optionalParams) =>
  console.log(clc.bgBlue(msg), ...optionalParams);
var debugMsg = clc.xterm(245);
const log_debug = (msg, ...optionalParams) =>
  console.log(debugMsg(msg), ...optionalParams);

const PLATFORM_MAP = {
  "x86_64-pc-windows-msvc": "win32",
  "i686-pc-windows-msvc": "win32",
  "aarch64-pc-windows-msvc": "win32",
  "x86_64-apple-darwin": "darwin",
  "aarch64-apple-darwin": "darwin",
  "x86_64-unknown-linux-gnu": "linux",
  "i686-unknown-linux-gnu": "linux",
  "aarch64-unknown-linux-gnu": "linux",
  "armv7-unknown-linux-gnueabihf": "linux",
  "riscv64gc-unknown-linux-gnu": "linux",
  "loongarch64-unknown-linux-gnu": "linux",
};
const ARCH_MAP = {
  "x86_64-pc-windows-msvc": "x64",
  "i686-pc-windows-msvc": "ia32",
  "aarch64-pc-windows-msvc": "arm64",
  "x86_64-apple-darwin": "x64",
  "aarch64-apple-darwin": "arm64",
  "x86_64-unknown-linux-gnu": "x64",
  "i686-unknown-linux-gnu": "ia32",
  "aarch64-unknown-linux-gnu": "arm64",
  "armv7-unknown-linux-gnueabihf": "arm",
  "riscv64gc-unknown-linux-gnu": "riscv64",
  "loongarch64-unknown-linux-gnu": "loong64",
};

const arg1 = process_argvs.slice(2)[0];
const arg2 = process_argvs.slice(2)[1];
const target = arg1 === "--force" ? arg2 : arg1;
const { platform, arch } = target
  ? { platform: PLATFORM_MAP[target], arch: ARCH_MAP[target] }
  : process;

const SIDECAR_HOST = target
  ? target
  : execSync("rustc -vV")
      .toString()
      .match(/(?<=host: ).+(?=\s*)/g)[0];

/* ======= clash meta alpha======= */
const META_ALPHA_VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt";
const META_ALPHA_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha`;
let META_ALPHA_VERSION;

const META_ALPHA_MAP = {
  "win32-x64": "mihomo-windows-amd64-compatible",
  "win32-ia32": "mihomo-windows-386",
  "win32-arm64": "mihomo-windows-arm64",
  "darwin-x64": "mihomo-darwin-amd64-compatible",
  "darwin-arm64": "mihomo-darwin-arm64",
  "linux-x64": "mihomo-linux-amd64-compatible",
  "linux-ia32": "mihomo-linux-386",
  "linux-arm64": "mihomo-linux-arm64",
  "linux-arm": "mihomo-linux-armv7",
  "linux-riscv64": "mihomo-linux-riscv64",
  "linux-loong64": "mihomo-linux-loong64",
};

// Fetch the latest alpha release version from the version.txt file
async function getLatestAlphaVersion() {
  const options = {};

  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;

  if (httpProxy) {
    options.agent = proxyAgent(httpProxy);
  }
  try {
    const response = await fetch(META_ALPHA_VERSION_URL, {
      ...options,
      method: "GET",
    });
    let v = await response.text();
    META_ALPHA_VERSION = v.trim(); // Trim to remove extra whitespaces
    log_info(`Latest alpha version: ${META_ALPHA_VERSION}`);
  } catch (error) {
    log_error("Error fetching latest alpha version:", error.message);
    process.exit(1);
  }
}

/* ======= clash meta stable ======= */
const META_VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt";
const META_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download`;
let META_VERSION;

const META_MAP = {
  "win32-x64": "mihomo-windows-amd64-compatible",
  "win32-ia32": "mihomo-windows-386",
  "win32-arm64": "mihomo-windows-arm64",
  "darwin-x64": "mihomo-darwin-amd64-compatible",
  "darwin-arm64": "mihomo-darwin-arm64",
  "linux-x64": "mihomo-linux-amd64-compatible",
  "linux-ia32": "mihomo-linux-386",
  "linux-arm64": "mihomo-linux-arm64",
  "linux-arm": "mihomo-linux-armv7",
  "linux-riscv64": "mihomo-linux-riscv64",
  "linux-loong64": "mihomo-linux-loong64",
};

// Fetch the latest release version from the version.txt file
async function getLatestReleaseVersion() {
  const options = {};

  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;

  if (httpProxy) {
    options.agent = proxyAgent(httpProxy);
  }
  try {
    const response = await fetch(META_VERSION_URL, {
      ...options,
      method: "GET",
    });
    let v = await response.text();
    META_VERSION = v.trim(); // Trim to remove extra whitespaces
    log_info(`Latest release version: ${META_VERSION}`);
  } catch (error) {
    log_error("Error fetching latest release version:", error.message);
    process.exit(1);
  }
}

/*
 * check available
 */
if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(
    `clash meta alpha unsupported platform "${platform}-${arch}"`,
  );
}

if (!META_ALPHA_MAP[`${platform}-${arch}`]) {
  throw new Error(
    `clash meta alpha unsupported platform "${platform}-${arch}"`,
  );
}

/**
 * core info
 */
function clashMetaAlpha() {
  const name = META_ALPHA_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${META_ALPHA_URL_PREFIX}/${name}-${META_ALPHA_VERSION}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${META_ALPHA_VERSION}.${urlExt}`;

  return {
    name: "verge-mihomo-alpha",
    targetFile: `verge-mihomo-alpha-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

function clashMeta() {
  const name = META_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${META_URL_PREFIX}/${META_VERSION}/${name}-${META_VERSION}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${META_VERSION}.${urlExt}`;

  return {
    name: "verge-mihomo",
    targetFile: `verge-mihomo-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
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
        log_debug(`"${name}" entry name`, entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      await fs.rename(tempExe, sidecarPath);
      log_success(`unzip finished: "${name}"`);
    } else if (zipFile.endsWith(".tgz")) {
      // tgz
      await fs.mkdirp(tempDir);
      await tar.extract({
        cwd: tempDir,
        file: tempZip,
        //strip: 1, // 可能需要根据实际的 .tgz 文件结构调整
      });
      const files = await fs.readdir(tempDir);
      log_debug(`"${name}" files in tempDir:`, files);
      const extractedFile = files.find((file) => file.startsWith("虚空终端-"));
      if (extractedFile) {
        const extractedFilePath = path.join(tempDir, extractedFile);
        await fs.rename(extractedFilePath, sidecarPath);
        log_debug(`"${name}" file renamed to "${sidecarPath}"`);
        execSync(`chmod 755 ${sidecarPath}`);
        log_success(`chmod binary finished: "${name}"`);
      } else {
        throw new Error(`Expected file not found in ${tempDir}`);
      }
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip);
      const writeStream = fs.createWriteStream(sidecarPath);
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          log_error(`gz failed ["${name}"]: `, error.message);
          reject(error);
        };
        readStream
          .pipe(zlib.createGunzip().on("error", onError))
          .pipe(writeStream)
          .on("finish", () => {
            log_success(`gunzip finished: "${name}"`);
            execSync(`chmod 755 ${sidecarPath}`);
            log_success(`chmod binary finished: "${name}"`);
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
  const { file, downloadURL, localPath } = binInfo;

  const resDir = path.join(cwd, "src-tauri/resources");
  const targetPath = path.join(resDir, file);

  if (!FORCE && (await fs.pathExists(targetPath))) return;

  await fs.mkdirp(resDir);
  if (downloadURL) {
    await downloadFile(downloadURL, targetPath);
  }
  if (localPath) {
    await fs.copyFile(localPath, targetPath);
    log_debug(`copy file finished: "${localPath}"`);
  }

  log_success(`resolve finished: ${file}`);
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

  log_debug(`download finished: "${url}"`);
}

// SimpleSC.dll
const resolvePlugin = async () => {
  const url =
    "https://nsis.sourceforge.io/mediawiki/images/e/ef/NSIS_Simple_Service_Plugin_Unicode_1.30.zip";

  const tempDir = path.join(TEMP_DIR, "SimpleSC");
  const tempZip = path.join(
    tempDir,
    "NSIS_Simple_Service_Plugin_Unicode_1.30.zip",
  );
  const tempDll = path.join(tempDir, "SimpleSC.dll");
  const pluginDir = path.join(process.env.APPDATA, "Local/NSIS");
  const pluginPath = path.join(pluginDir, "SimpleSC.dll");
  await fs.mkdirp(pluginDir);
  await fs.mkdirp(tempDir);
  if (!FORCE && (await fs.pathExists(pluginPath))) return;
  try {
    if (!(await fs.pathExists(tempZip))) {
      await downloadFile(url, tempZip);
    }
    const zip = new AdmZip(tempZip);
    zip.getEntries().forEach((entry) => {
      log_debug(`"SimpleSC" entry name`, entry.entryName);
    });
    zip.extractAllTo(tempDir, true);
    await fs.copyFile(tempDll, pluginPath);
    log_success(`unzip finished: "SimpleSC"`);
  } finally {
    await fs.remove(tempDir);
  }
};

// service chmod
const resolveServicePermission = async () => {
  const serviceExecutables = [
    "clash-verge-service",
    "install-service",
    "uninstall-service",
  ];
  const resDir = path.join(cwd, "src-tauri", "resources");
  for (let f of serviceExecutables) {
    const targetPath = path.join(resDir, f);
    if (await fs.pathExists(targetPath)) {
      execSync(`chmod 755 ${targetPath}`);
      log_success(`chmod finished: "${f}"`);
    }
  }
};

// clash-verge-service
const GET_LATEST_RELEASE_API =
  "https://api.github.com/repos/oomeow/clash-verge-service/releases/latest";

async function getLatestClashVergeServices() {
  const response = await fetch(GET_LATEST_RELEASE_API);
  const json = await response.json();
  const version = json.tag_name;
  log_info(`Latest Clash Verge Service version: ${version}`);
  const assets = json.assets;
  const downloadItem = assets.find((item) => item.name.includes(SIDECAR_HOST));
  return {
    file: downloadItem.name,
    downloadURL: downloadItem.browser_download_url,
  };
}

function getAlphaClashVergeServices() {
  const fileName = `clash-verge-service-${SIDECAR_HOST}.tar.gz`;
  const downloadURL = `https://github.com/oomeow/clash-verge-service/releases/download/alpha/${fileName}`;
  return {
    file: fileName,
    downloadURL: downloadURL,
  };
}

const resolveClashVergeService = async () => {
  let downloadItem;
  if (useAlphaService) {
    downloadItem = await getAlphaClashVergeServices();
  } else {
    downloadItem = await getLatestClashVergeServices();
  }
  let serviceCheckList = [
    "clash-verge-service",
    "install-service",
    "uninstall-service",
  ];
  if (platform === "win32") {
    serviceCheckList = [
      "clash-verge-service.exe",
      "install-service.exe",
      "uninstall-service.exe",
    ];
  }
  const resourceDir = path.join(cwd, "src-tauri", "resources");
  let needResolve = false;
  for (let file of serviceCheckList) {
    const targetPath = path.join(resourceDir, file);
    if (!(await fs.pathExists(targetPath))) {
      needResolve = true;
      break;
    }
  }

  if (!FORCE && !needResolve) return;

  if (!downloadItem) {
    log_error("can not find service to download");
    return;
  }
  const tempDir = path.join(TEMP_DIR, "clash-verge-service");
  const tempGz = path.join(tempDir, downloadItem.file);
  await fs.mkdirp(tempDir);
  await fs.mkdirp(resourceDir);
  try {
    await downloadFile(downloadItem.downloadURL, tempGz);
    await tar.x({ cwd: resourceDir, file: tempGz });
    log_success("unzip Clash Verge Service finished");
  } catch (e) {
    fs.remove(tempDir);
    log_error("resolve Clash Verge Service error, ", e);
  } finally {
    fs.remove(tempDir);
  }
};

const resolveSetDnsScript = () =>
  resolveResource({
    file: "set_dns.sh",
    localPath: path.join(cwd, "scripts/set_dns.sh"),
  });
const resolveUnSetDnsScript = () =>
  resolveResource({
    file: "unset_dns.sh",
    localPath: path.join(cwd, "scripts/unset_dns.sh"),
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
const resolveASN = () =>
  resolveResource({
    file: "ASN.mmdb",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb`,
  });
const resolveEnableLoopback = () =>
  resolveResource({
    file: "enableLoopback.exe",
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`,
  });

const tasks = [
  {
    name: "verge-mihomo-alpha",
    func: () =>
      getLatestAlphaVersion().then(() => resolveSidecar(clashMetaAlpha())),
    retry: 5,
  },
  {
    name: "verge-mihomo",
    func: () =>
      getLatestReleaseVersion().then(() => resolveSidecar(clashMeta())),
    retry: 5,
  },
  { name: "plugin", func: resolvePlugin, retry: 5, winOnly: true },
  { name: "clash-verge-service", func: resolveClashVergeService, retry: 5 },
  {
    name: "set_dns_script",
    func: resolveSetDnsScript,
    retry: 5,
    macOnly: true,
  },
  {
    name: "unset_dns_script",
    func: resolveUnSetDnsScript,
    retry: 5,
    macOnly: true,
  },
  { name: "mmdb", func: resolveMmdb, retry: 5 },
  { name: "geosite", func: resolveGeosite, retry: 5 },
  { name: "geoip", func: resolveGeoIP, retry: 5 },
  { name: "asn", func: resolveASN, retry: 5 },
  {
    name: "enableLoopback",
    func: resolveEnableLoopback,
    retry: 5,
    winOnly: true,
  },
  {
    name: "service_chmod",
    func: resolveServicePermission,
    retry: 1,
    unixOnly: true,
  },
];

async function runTask() {
  const task = tasks.shift();
  if (!task) return;
  if (task.winOnly && platform !== "win32") return runTask();
  if (task.linuxOnly && platform !== "linux") return runTask();
  if (task.unixOnly && platform === "win32") return runTask();
  if (task.macOnly && platform !== "darwin") return runTask();

  for (let i = 0; i < task.retry; i++) {
    try {
      if (task.name === "plugin") log_info("Resolve plugin");
      if (task.name === "service") log_info("Resolve resources");
      if (task.name === "service_chmod") log_info("Chmod resources");
      await task.func();
      break;
    } catch (err) {
      log_error(`task::${task.name} try ${i} ==`, err.message);
      // wait 1s
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (i === task.retry - 1) throw err;
    }
  }
  return runTask();
}

runTask();
// runTask();
