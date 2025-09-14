import AdmZip from "adm-zip";
import { execSync } from "child_process";
import { consola } from "consola";
import fs from "fs-extra";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import path from "path";
import * as tar from "tar";
import zlib from "zlib";
import ora from "ora";

const VERGE_SERVICE_VERSION = "v2.0.0";
const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
let process_argvs = process.argv;
const FORCE = process_argvs.includes("--force");
const useAlphaService = process_argvs.includes("--alpha");
if (useAlphaService) {
  process_argvs = process_argvs.filter((item) => item !== "--alpha");
}

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
const EXE_SUFFIX = platform === "win32" ? ".exe" : "";

/* ======= mihomo stable ======= */
const MIHOMO_VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt";
const MIHOMO_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download`;
let MIHOMO_VERSION;

const MIHOMO_MAP = {
  "win32-x64": "mihomo-windows-amd64-v3",
  "win32-ia32": "mihomo-windows-386",
  "win32-arm64": "mihomo-windows-arm64",
  "darwin-x64": "mihomo-darwin-amd64-v3",
  "darwin-arm64": "mihomo-darwin-arm64",
  "linux-x64": "mihomo-linux-amd64-v3",
  "linux-ia32": "mihomo-linux-386",
  "linux-arm64": "mihomo-linux-arm64",
  "linux-arm": "mihomo-linux-armv7",
  "linux-riscv64": "mihomo-linux-riscv64",
  "linux-loong64": "mihomo-linux-loong64",
};

/* ======= mihomo alpha======= */
const MIHOMO_ALPHA_VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt";
const MIHOMO_ALPHA_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha`;
let MIHOMO_ALPHA_VERSION;

const MIHOMO_ALPHA_MAP = {
  "win32-x64": "mihomo-windows-amd64-v3",
  "win32-ia32": "mihomo-windows-386",
  "win32-arm64": "mihomo-windows-arm64",
  "darwin-x64": "mihomo-darwin-amd64-v3",
  "darwin-arm64": "mihomo-darwin-arm64",
  "linux-x64": "mihomo-linux-amd64-v3",
  "linux-ia32": "mihomo-linux-386",
  "linux-arm64": "mihomo-linux-arm64",
  "linux-arm": "mihomo-linux-armv7",
  "linux-riscv64": "mihomo-linux-riscv64",
  "linux-loong64": "mihomo-linux-loong64",
};

// check available
if (!MIHOMO_MAP[`${platform}-${arch}`]) {
  throw new Error(`mihomo unsupported platform "${platform}-${arch}"`);
}
if (!MIHOMO_ALPHA_MAP[`${platform}-${arch}`]) {
  throw new Error(`mihomo alpha unsupported platform "${platform}-${arch}"`);
}

/**
 * fetch with timeout (default timeout: 8000ms)
 */
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options; // 默认超时时间为 8 秒
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`fetch timeout: ${timeout}ms`);
    } else {
      throw new Error("fetch error: ", error);
    }
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch the latest release version from the `version.txt` file
 */
async function getLatestReleaseVersion() {
  const spinner = ora({
    text: "get latest mihomo stable version",
    color: "yellow",
    spinner: "circle",
  });
  spinner.start();

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
    const response = await fetchWithTimeout(MIHOMO_VERSION_URL, {
      ...options,
      method: "GET",
    });
    const v = await response.text();
    MIHOMO_VERSION = v.trim(); // Trim to remove extra whitespaces
    spinner.succeed(`Latest release version: ${MIHOMO_VERSION}`);
  } catch (error) {
    spinner.fail(`Error fetching latest release version: ${error.message}`);
    throw new Error(error);
  }
}
/**
 *  Fetch the latest alpha release version from the `version.txt` file
 */
async function getLatestAlphaVersion() {
  const spinner = ora({
    text: "get latest mihomo alpha version",
    color: "yellow",
    spinner: "circle",
  });
  spinner.start();
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
    const response = await fetchWithTimeout(MIHOMO_ALPHA_VERSION_URL, {
      ...options,
      method: "GET",
    });
    const v = await response.text();
    MIHOMO_ALPHA_VERSION = v.trim(); // Trim to remove extra whitespaces
    spinner.succeed(`Latest alpha version: ${MIHOMO_ALPHA_VERSION}`);
  } catch (error) {
    spinner.fail(`Error fetching latest alpha version: ${error.message}`);
    throw new Error(error);
  }
}

/**
 * mihomo stable version info
 */
function mihomo() {
  const name = MIHOMO_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${MIHOMO_URL_PREFIX}/${MIHOMO_VERSION}/${name}-${MIHOMO_VERSION}.${urlExt}`;
  const exeFile = `${name}${EXE_SUFFIX}`;
  const zipFile = `${name}-${MIHOMO_VERSION}.${urlExt}`;
  return {
    name: "verge-mihomo",
    targetFile: `verge-mihomo-${SIDECAR_HOST}${EXE_SUFFIX}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

/**
 * mihomo alpha version info
 */
function mihomoAlpha() {
  const name = MIHOMO_ALPHA_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${MIHOMO_ALPHA_URL_PREFIX}/${name}-${MIHOMO_ALPHA_VERSION}.${urlExt}`;
  const exeFile = `${name}${EXE_SUFFIX}`;
  const zipFile = `${name}-${MIHOMO_ALPHA_VERSION}.${urlExt}`;
  return {
    name: "verge-mihomo-alpha",
    targetFile: `verge-mihomo-alpha-${SIDECAR_HOST}${EXE_SUFFIX}`,
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

  const spinner = ora({
    text: `resolve sidecar ${name}`,
    color: "yellow",
    spinner: "circle",
  });
  spinner.start();

  const sidecarDir = path.join(cwd, "src-tauri", "sidecar");
  const sidecarPath = path.join(sidecarDir, targetFile);

  await fs.mkdirp(sidecarDir);
  if (!FORCE && (await fs.pathExists(sidecarPath))) {
    spinner.succeed(`${targetFile} has exists`);
    return;
  }

  const tempDir = path.join(TEMP_DIR, name);
  const tempZip = path.join(tempDir, zipFile);
  const tempExe = path.join(tempDir, exeFile);

  await fs.mkdirp(tempDir);
  try {
    if (!(await fs.pathExists(tempZip))) {
      await downloadFile(downloadURL, tempZip, spinner);
    }

    if (zipFile.endsWith(".zip")) {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        spinner.text = `"${name}" entry name`;
      });
      spinner.text = "extract zip file to temp dir";
      zip.extractAllTo(tempDir, true);
      await fs.rename(tempExe, sidecarPath);
      spinner.succeed(`unzip finished: "${name}"`);
    } else if (zipFile.endsWith(".tgz")) {
      // tgz
      await fs.mkdirp(tempDir);
      await tar.extract({
        cwd: tempDir,
        file: tempZip,
        //strip: 1, // 可能需要根据实际的 .tgz 文件结构调整
      });
      const files = await fs.readdir(tempDir);
      spinner.text = `"${name}" files in tempDir: ${files}`;
      const extractedFile = files.find((file) => file.startsWith("虚空终端-"));
      if (extractedFile) {
        const extractedFilePath = path.join(tempDir, extractedFile);
        spinner.text = `"${name}" file renam to "${sidecarPath}"`;
        await fs.rename(extractedFilePath, sidecarPath);
        spinner.text = `"chmod 755 to "${sidecarPath}"`;
        execSync(`chmod 755 ${sidecarPath}`);
        spinner.succeed(`chmod binary finished: "${name}"`);
      } else {
        throw new Error(`Expected file not found in ${tempDir}`);
      }
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip);
      const writeStream = fs.createWriteStream(sidecarPath);
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          spinner.fail(`gz failed ["${name}"]: `, error.message);
          reject(error);
        };
        readStream
          .pipe(zlib.createGunzip().on("error", onError))
          .pipe(writeStream)
          .on("finish", () => {
            spinner.text = `gunzip finished: "${name}"`;
            execSync(`chmod 755 ${sidecarPath}`);
            spinner.succeed(`chmod binary finished: "${name}"`);
            resolve();
          })
          .on("error", onError);
      });
    }
  } catch (err) {
    spinner.fail(`${err}`);
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
  const spinner = ora({
    text: `resolve resource ${file}`,
    color: "yellow",
    spinner: "circle",
  });
  spinner.start();

  try {
    const resDir = path.join(cwd, "src-tauri/resources");
    const targetPath = path.join(resDir, file);

    if (!FORCE && (await fs.pathExists(targetPath))) {
      spinner.succeed(`${file} has exists`);
      return;
    }

    await fs.mkdirp(resDir);
    if (downloadURL) {
      spinner.text = `download ${file}...`;
      await downloadFile(downloadURL, targetPath, spinner);
    }
    if (localPath) {
      spinner.text = `copy ${file} to ${targetPath}`;
      await fs.copyFile(localPath, targetPath);
      spinner.text = `copy file finished: "${localPath}"`;
    }
    spinner.succeed(`resolve finished: ${file}`);
  } catch (err) {
    spinner.fail(`resolve failed: ${file}`);
    throw new Error(err);
  }
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path, spinner) {
  const options = {};
  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;
  if (httpProxy) {
    options.agent = new HttpsProxyAgent(httpProxy);
  }
  spinner.text = `downloading: ${url}`;
  const response = await fetchWithTimeout(url, {
    ...options,
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
    timeout: 1000 * 60 * 2, // 下载文件默认超时 2 分钟
  });
  const buffer = await response.arrayBuffer();
  await fs.writeFile(path, new Uint8Array(buffer));
  spinner.text = `download finished: "${url}"`;
}

/**
 * NSIS plugin: `SimpleSC.dll`
 *
 * only for Windows
 */
const resolvePlugin = async () => {
  consola.info("Resolve NSIS plugin (SimpleSC)");
  const spinner = ora({
    text: "resolve NSIS plugin (SimpleSC)",
    color: "yellow",
    spinner: "circle",
  });
  spinner.start();

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
  if (!FORCE && (await fs.pathExists(pluginPath))) {
    spinner.succeed("NSIS plugin (SimpleSC) has exists");
    return;
  }
  try {
    if (!(await fs.pathExists(tempZip))) {
      await downloadFile(url, tempZip, spinner);
    }
    const zip = new AdmZip(tempZip);
    zip.getEntries().forEach((entry) => {
      spinner.text = `"SimpleSC" entry name ${entry.entryName}`;
    });
    zip.extractAllTo(tempDir, true);
    await fs.copyFile(tempDll, pluginPath);
    spinner.succeed(`unzip finished: "SimpleSC"`);
  } finally {
    await fs.remove(tempDir);
  }
};

/**
 * chmod 755 for Clash Verge Service
 */
const resolveServicePermission = async () => {
  const serviceExecutable = `clash-verge-service${EXE_SUFFIX}`;
  const resDir = path.join(cwd, "src-tauri", "resources");
  const targetPath = path.join(resDir, serviceExecutable);
  if (await fs.pathExists(targetPath)) {
    execSync(`chmod 755 ${targetPath}`);
    consola.success(`chmod finished: "${serviceExecutable}"`);
  }
};

/**
 * Clash Verge Service Latest Version
 *
 * TODO: get Clash Verge Service latest version by use request
 */
async function getLatestClashVergeServices() {
  // TODO: Github rest api are rate-limited
  // const GET_LATEST_RELEASE_API =
  //   "https://api.github.com/repos/oomeow/clash-verge-service/releases/latest";
  // const response = await fetch(GET_LATEST_RELEASE_API);
  // const json = await response.json();
  // const version = json.tag_name;
  // log_info(`Latest Clash Verge Service version: ${version}`);
  // const assets = json.assets;
  // const downloadItem = assets.find((item) => item.name.includes(SIDECAR_HOST));
  // return {
  //   file: downloadItem.name,
  //   downloadURL: downloadItem.browser_download_url,
  // };
  const fileName = `clash-verge-service-${SIDECAR_HOST}${EXE_SUFFIX}`;
  const downloadURL = `https://github.com/oomeow/clash-verge-service/releases/download/${VERGE_SERVICE_VERSION}/${fileName}`;
  return {
    file: fileName,
    downloadURL: downloadURL,
  };
}

/**
 * Clash Verge Service Latest Alpha Version
 */
function getAlphaClashVergeServices() {
  const fileName = `clash-verge-service-${SIDECAR_HOST}${EXE_SUFFIX}`;
  const downloadURL = `https://github.com/oomeow/clash-verge-service/releases/download/alpha/${fileName}`;
  return {
    file: fileName,
    downloadURL: downloadURL,
  };
}

const resolveClashVergeService = async () => {
  const versionTag = useAlphaService ? "Alpha" : "Stable";
  consola.info(`Download Clash Verge Service (${versionTag})`);
  let downloadItem;
  if (useAlphaService) {
    downloadItem = getAlphaClashVergeServices();
  } else {
    downloadItem = await getLatestClashVergeServices();
  }
  await resolveResource({
    file: `clash-verge-service${EXE_SUFFIX}`,
    downloadURL: downloadItem.downloadURL,
  });
};

const resolveSetDnsScript = async () => {
  consola.info("Resolve Macos set dns script");
  await resolveResource({
    file: "set_dns.sh",
    localPath: path.join(cwd, "scripts/set_dns.sh"),
  });
};

const resolveUnSetDnsScript = async () => {
  consola.info("Resolve Macos unset dns script");
  await resolveResource({
    file: "unset_dns.sh",
    localPath: path.join(cwd, "scripts/unset_dns.sh"),
  });
};

const resolveMmdb = async () => {
  consola.info("Resolve Country mmdb");
  await resolveResource({
    file: "Country.mmdb",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb`,
  });
};

const resolveGeosite = async () => {
  consola.info("Resolve geosite");
  await resolveResource({
    file: "geosite.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`,
  });
};

const resolveGeoIP = async () => {
  consola.info("Resolve geoip");
  await resolveResource({
    file: "geoip.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`,
  });
};

const resolveASN = async () => {
  consola.info("Resolve ASN mmdb");
  await resolveResource({
    file: "ASN.mmdb",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb`,
  });
};

const resolveEnableLoopback = async () => {
  consola.info("Resolve enableLoopback.exe");
  await resolveResource({
    file: "enableLoopback.exe",
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`,
  });
};

const tasks = [
  {
    name: "verge-mihomo",
    func: async () => {
      consola.info("Download and unzip Latest Mihomo Stable Version");
      await getLatestReleaseVersion();
      await resolveSidecar(mihomo());
    },
    retry: 5,
  },
  {
    name: "verge-mihomo-alpha",
    func: async () => {
      consola.info("Download and unzip Latest Mihomo Alpha Version");
      await getLatestAlphaVersion();
      await resolveSidecar(mihomoAlpha());
    },
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

/**
 * main function for run tasks
 */
async function runTask() {
  consola.box("Check and download files");
  while (tasks.length > 0) {
    const task = tasks.shift();
    if (!task) {
      consola.success("all tasks has run finished");
      return;
    }
    if (task.winOnly && platform !== "win32") continue;
    if (task.linuxOnly && platform !== "linux") continue;
    if (task.unixOnly && platform === "win32") continue;
    if (task.macOnly && platform !== "darwin") continue;

    for (let i = 0; i < task.retry; i++) {
      try {
        await task.func();
        break;
      } catch (err) {
        consola.error(
          `task::${task.name} attempt ${i}/${task.retry}, error message: `,
          err.message,
        );
        // wait 1s
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (i === task.retry - 1) throw err;
      }
    }
  }
}

// run
runTask();
