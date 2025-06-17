import fs from "fs";
import fsp from "fs/promises";
import zlib from "zlib";
import { extract } from "tar";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { execSync } from "child_process";
import { log_info, log_debug, log_error, log_success } from "./utils.mjs";
import { glob } from "glob";

const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
const FORCE = process.argv.includes("--force");

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
    options.agent = new HttpsProxyAgent(httpProxy);
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
    options.agent = new HttpsProxyAgent(httpProxy);
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

  await fsp.mkdir(sidecarDir, { recursive: true });
  if (!FORCE && fs.existsSync(sidecarPath)) return;

  const tempDir = path.join(TEMP_DIR, name);
  const tempZip = path.join(tempDir, zipFile);
  const tempExe = path.join(tempDir, exeFile);

  await fsp.mkdir(tempDir, { recursive: true });
  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(downloadURL, tempZip);
    }

    if (zipFile.endsWith(".zip")) {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        log_debug(`"${name}" entry name`, entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      await fsp.rename(tempExe, sidecarPath);
      log_success(`unzip finished: "${name}"`);
    } else if (zipFile.endsWith(".tgz")) {
      // tgz
      await fsp.mkdir(tempDir, { recursive: true });
      await extract({
        cwd: tempDir,
        file: tempZip,
        //strip: 1, // 可能需要根据实际的 .tgz 文件结构调整
      });
      const files = await fsp.readdir(tempDir);
      log_debug(`"${name}" files in tempDir:`, files);
      const extractedFile = files.find((file) => file.startsWith("虚空终端-"));
      if (extractedFile) {
        const extractedFilePath = path.join(tempDir, extractedFile);
        await fsp.rename(extractedFilePath, sidecarPath);
        log_success(`"${name}" file renamed to "${sidecarPath}"`);
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
          log_error(`"${name}" gz failed:`, error.message);
          reject(error);
        };
        readStream
          .pipe(zlib.createGunzip().on("error", onError))
          .pipe(writeStream)
          .on("finish", () => {
            execSync(`chmod 755 ${sidecarPath}`);
            log_success(`chmod binary finished: "${name}"`);
            resolve();
          })
          .on("error", onError);
      });
    }
  } catch (err) {
    // 需要删除文件
    await fsp.rm(sidecarPath, { recursive: true, force: true });
    throw err;
  } finally {
    // delete temp dir
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

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

/**
 * download the file to the resources dir
 */
async function resolveResource(binInfo) {
  const { file, downloadURL, localPath } = binInfo;

  const resDir = path.join(cwd, "src-tauri/resources");
  const targetPath = path.join(resDir, file);

  if (!FORCE && fs.existsSync(targetPath)) return;

  if (downloadURL) {
    await fsp.mkdir(resDir, { recursive: true });
    await downloadFile(downloadURL, targetPath);
  }

  if (localPath) {
    await fs.copyFile(localPath, targetPath, (err) => {
      if (err) {
        console.error("Error copying file:", err);
      } else {
        console.log("File was copied successfully");
      }
    });
    log_debug(`copy file finished: "${localPath}"`);
  }

  log_success(`${file} finished`);
}

/**
 * download file and save to `path`
 */ async function downloadFile(url, path) {
  const options = {};

  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;

  if (httpProxy) {
    options.agent = new HttpsProxyAgent(httpProxy);
  }

  const response = await fetch(url, {
    ...options,
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });
  const buffer = await response.arrayBuffer();
  await fsp.writeFile(path, new Uint8Array(buffer));

  log_success(`download finished: ${url}`);
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
  await fsp.mkdir(pluginDir, { recursive: true });
  await fsp.mkdir(tempDir, { recursive: true });
  if (!FORCE && fs.existsSync(pluginPath)) return;
  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(url, tempZip);
    }
    const zip = new AdmZip(tempZip);
    zip.getEntries().forEach((entry) => {
      log_debug(`"SimpleSC" entry name`, entry.entryName);
    });
    zip.extractAllTo(tempDir, true);
    await fsp.cp(tempDll, pluginPath, { recursive: true, force: true });
    log_success(`unzip finished: "SimpleSC"`);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
};

// service chmod
const resolveServicePermission = async () => {
  const serviceExecutables = [
    "clash-verge-service*",
    "install-service*",
    "uninstall-service*",
  ];
  const resDir = path.join(cwd, "src-tauri/resources");
  for (let f of serviceExecutables) {
    // 使用glob模块来处理通配符
    const files = glob.sync(path.join(resDir, f));
    for (let filePath of files) {
      if (fs.existsSync(filePath)) {
        execSync(`chmod 755 ${filePath}`);
        log_success(`chmod finished: "${filePath}"`);
      }
    }
  }
};

// 在 resolveResource 函数后添加新函数
async function resolveLocales() {
  const srcLocalesDir = path.join(cwd, "src/locales");
  const targetLocalesDir = path.join(cwd, "src-tauri/resources/locales");

  try {
    // 确保目标目录存在
    await fsp.mkdir(targetLocalesDir, { recursive: true });

    // 读取所有语言文件
    const files = await fsp.readdir(srcLocalesDir);

    // 复制每个文件
    for (const file of files) {
      const srcPath = path.join(srcLocalesDir, file);
      const targetPath = path.join(targetLocalesDir, file);

      await fsp.copyFile(srcPath, targetPath);
      log_success(`Copied locale file: ${file}`);
    }

    log_success("All locale files copied successfully");
  } catch (err) {
    log_error("Error copying locale files:", err.message);
    throw err;
  }
}

/**
 * main
 */
const SERVICE_URL = `https://github.com/clash-verge-rev/clash-verge-service/releases/download/${SIDECAR_HOST}`;

const resolveService = () => {
  let ext = platform === "win32" ? ".exe" : "";
  let suffix = platform === "linux" ? "-" + SIDECAR_HOST : "";
  resolveResource({
    file: "clash-verge-service" + suffix + ext,
    downloadURL: `${SERVICE_URL}/clash-verge-service${ext}`,
  });
};

const resolveInstall = () => {
  let ext = platform === "win32" ? ".exe" : "";
  let suffix = platform === "linux" ? "-" + SIDECAR_HOST : "";
  resolveResource({
    file: "install-service" + suffix + ext,
    downloadURL: `${SERVICE_URL}/install-service${ext}`,
  });
};

const resolveUninstall = () => {
  let ext = platform === "win32" ? ".exe" : "";
  let suffix = platform === "linux" ? "-" + SIDECAR_HOST : "";

  resolveResource({
    file: "uninstall-service" + suffix + ext,
    downloadURL: `${SERVICE_URL}/uninstall-service${ext}`,
  });
};

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

const resolveWinSysproxy = () =>
  resolveResource({
    file: "sysproxy.exe",
    downloadURL: `https://github.com/clash-verge-rev/sysproxy/releases/download/${arch}/sysproxy.exe`,
  });

const tasks = [
  // { name: "clash", func: resolveClash, retry: 5 },
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
  { name: "service", func: resolveService, retry: 5 },
  { name: "install", func: resolveInstall, retry: 5 },
  { name: "uninstall", func: resolveUninstall, retry: 5 },
  { name: "mmdb", func: resolveMmdb, retry: 5 },
  { name: "geosite", func: resolveGeosite, retry: 5 },
  { name: "geoip", func: resolveGeoIP, retry: 5 },
  {
    name: "enableLoopback",
    func: resolveEnableLoopback,
    retry: 5,
    winOnly: true,
  },
  {
    name: "service_chmod",
    func: resolveServicePermission,
    retry: 5,
    unixOnly: platform === "linux" || platform === "darwin",
  },
  {
    name: "windows-sysproxy",
    func: resolveWinSysproxy,
    retry: 5,
    winOnly: true,
  },
  {
    name: "set_dns_script",
    func: resolveSetDnsScript,
    retry: 5,
    macosOnly: true,
  },
  {
    name: "unset_dns_script",
    func: resolveUnSetDnsScript,
    retry: 5,
    macosOnly: true,
  },
  {
    name: "locales",
    func: resolveLocales,
    retry: 2,
  },
];

async function runTask() {
  const task = tasks.shift();
  if (!task) return;
  if (task.unixOnly && platform === "win32") return runTask();
  if (task.winOnly && platform !== "win32") return runTask();
  if (task.macosOnly && platform !== "darwin") return runTask();
  if (task.linuxOnly && platform !== "linux") return runTask();

  for (let i = 0; i < task.retry; i++) {
    try {
      await task.func();
      break;
    } catch (err) {
      log_error(`task::${task.name} try ${i} ==`, err.message);
      if (i === task.retry - 1) throw err;
    }
  }
  return runTask();
}

runTask();
