import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import proxyAgent from "https-proxy-agent";
import {
  META_ALPHA_VERSION_URL,
  META_ALPHA_URL_PREFIX,
  META_ALPHA_MAP,
  META_VERSION_URL,
  META_URL_PREFIX,
  META_MAP,
} from "./check-variables.mjs";

const cwd = process.cwd();
const STORE_DIR = path.join(cwd, "offline-dependencies");
const FORCE = process.argv.includes("--force");
const proxyOptions = {};

const httpProxy =
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy;

if (httpProxy) {
  proxyOptions.agent = proxyAgent(httpProxy);
}

/* ======= clash meta alpha======= */
let META_ALPHA_VERSION;

// Fetch the latest alpha release version from the version.txt file
async function getLatestAlphaVersion() {
  const dir = path.join(STORE_DIR, "sidecar/verge-mihomo-alpha");
  try {
    const response = await fetch(META_ALPHA_VERSION_URL, {
      ...proxyOptions,
      method: "GET",
    });
    META_ALPHA_VERSION = (await response.text()).trim(); // Trim to remove extra whitespaces
    const name = Object.values(META_ALPHA_MAP)[0];
    const urlExt = name.includes("windows") ? "zip" : "gz";
    const filePath = path.join(dir, `${name}-${META_ALPHA_VERSION}.${urlExt}`);
    if (FORCE || !fs.existsSync(filePath)) {
      fs.removeSync(dir); // 不存在则表示版本不一致了，所以要删除整个目录重新下载新版本
    }
    fs.mkdirpSync(dir);
    fs.writeFileSync(path.join(dir, "version.txt"), META_ALPHA_VERSION);
    console.log(
      `Latest verge-mihomo-alpha release version: ${META_ALPHA_VERSION}`
    );
  } catch (error) {
    console.error(
      "Error fetching latest verge-mihomo-alpha release version:",
      error.message
    );
    process.exit(1);
  }
}

function clashMetaAlpha(name) {
  const urlExt = name.includes("windows") ? "zip" : "gz";
  const downloadURL = `${META_ALPHA_URL_PREFIX}/${name}-${META_ALPHA_VERSION}.${urlExt}`;

  return resolveResource({
    dir: "sidecar/verge-mihomo-alpha",
    file: `${name}-${META_ALPHA_VERSION}.${urlExt}`,
    downloadURL,
  });
}

/* ======= clash meta stable ======= */
let META_VERSION;

// Fetch the latest release version from the version.txt file
async function getLatestReleaseVersion() {
  const dir = path.join(STORE_DIR, "sidecar/verge-mihomo");
  try {
    const response = await fetch(META_VERSION_URL, {
      ...proxyOptions,
      method: "GET",
    });
    META_VERSION = (await response.text()).trim(); // Trim to remove extra whitespaces
    const name = Object.values(META_MAP)[0];
    const urlExt = name.includes("windows") ? "zip" : "gz";
    const filePath = path.join(dir, `${name}-${META_VERSION}.${urlExt}`);
    if (FORCE || !fs.existsSync(filePath)) {
      fs.removeSync(dir); // 不存在则表示版本不一致了，所以要删除整个目录重新下载新版本
    }
    fs.mkdirpSync(dir);
    fs.writeFileSync(path.join(dir, "version.txt"), META_VERSION);
    console.log(`Latest verge-mihomo release version: ${META_VERSION}`);
  } catch (error) {
    console.error(
      "Error fetching latest verge-mihomo release version:",
      error.message
    );
    process.exit(1);
  }
}

function clashMeta(name) {
  const urlExt = name.includes("windows") ? "zip" : "gz";
  const downloadURL = `${META_URL_PREFIX}/${META_VERSION}/${name}-${META_VERSION}.${urlExt}`;

  return resolveResource({
    dir: "sidecar/verge-mihomo",
    file: `${name}-${META_VERSION}.${urlExt}`,
    downloadURL,
  });
}

/**
 * download the file to the resources dir
 */
async function resolveResource(binInfo) {
  const { dir, file, downloadURL } = binInfo;

  const resDir = path.join(STORE_DIR, dir);
  const targetPath = path.join(resDir, file);

  if (!FORCE && fs.pathExistsSync(targetPath)) return;

  fs.mkdirpSync(resDir);
  await downloadFile(downloadURL, targetPath);

  console.log(`[INFO]: ${file} finished`);
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path) {
  const response = await fetch(url, {
    ...proxyOptions,
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });
  const buffer = await response.arrayBuffer();
  await fs.writeFile(path, new Uint8Array(buffer));

  console.log(`[INFO]: download finished "${url}" to ${path}`);
}

// SimpleSC.dll
const resolvePlugin = async () => {
  const url =
    "https://nsis.sourceforge.io/mediawiki/images/e/ef/NSIS_Simple_Service_Plugin_Unicode_1.30.zip";

  const tempZip = path.join(
    STORE_DIR,
    "NSIS_Simple_Service_Plugin_Unicode_1.30.zip"
  );
  if (!FORCE && (await fs.pathExists(tempZip))) return;

  await downloadFile(url, tempZip);
};

// service chmod
const serviceExecutables = [
  "clash-verge-service",
  "install-service",
  "uninstall-service",
];
/**
 * main
 */
const CLASH_VERGE_SERVICE_LIST = [
  "armv7-unknown-linux-gnueabihf",
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "i686-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "i686-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
];
const SERVICE_URL = `https://github.com/clash-verge-rev/clash-verge-service/releases/download`;

const resolveClashVergeService = (platform, name) => {
  let ext = platform.includes("windows") ? ".exe" : "";
  resolveResource({
    dir: `clash-verge-service/${platform}`,
    file: name + ext,
    downloadURL: `${SERVICE_URL}/${platform}/${name}${ext}`,
  });
};

const resolveClashVergeServiceCode = () =>
  resolveResource({
    dir: "",
    file: "clash-verge-service-main.zip",
    downloadURL: `https://codeload.github.com/clash-verge-rev/clash-verge-service/zip/refs/heads/main`,
  });

const resolveSetDnsScriptCode = () =>
  resolveResource({
    dir: "",
    file: "set-dns-script-main.zip",
    downloadURL: `https://codeload.github.com/clash-verge-rev/set-dns-script/zip/refs/heads/main`,
  });
const resolveSetDnsScript = () =>
  resolveResource({
    dir: "set-dns-script",
    file: "set_dns.sh",
    downloadURL: `https://github.com/clash-verge-rev/set-dns-script/releases/download/script/set_dns.sh`,
  });
const resolveUnSetDnsScript = () =>
  resolveResource({
    dir: "set-dns-script",
    file: "unset_dns.sh",
    downloadURL: `https://github.com/clash-verge-rev/set-dns-script/releases/download/script/unset_dns.sh`,
  });
const resolveMmdb = () =>
  resolveResource({
    dir: "meta-rules-dat",
    file: "Country.mmdb",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb`,
  });
const resolveGeosite = () =>
  resolveResource({
    dir: "meta-rules-dat",
    file: "geosite.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`,
  });
const resolveGeoIP = () =>
  resolveResource({
    dir: "meta-rules-dat",
    file: "geoip.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`,
  });
const resolveEnableLoopback = () =>
  resolveResource({
    dir: "uwp-tool",
    file: "enableLoopback.exe",
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`,
  });

const tasks = [
  { name: "verge-mihomo-alpha-version", func: getLatestAlphaVersion, retry: 5 },
  ...Object.values(META_ALPHA_MAP).map((name) => ({
    name: "verge-mihomo-alpha",
    func: () => clashMetaAlpha(name),
    retry: 5,
  })),
  { name: "verge-mihomo-version", func: getLatestReleaseVersion, retry: 5 },
  ...Object.values(META_MAP).map((name) => ({
    name: "verge-mihomo",
    func: () => clashMeta(name),
    retry: 5,
  })),
  { name: "plugin", func: resolvePlugin, retry: 5 },
  ...CLASH_VERGE_SERVICE_LIST.flatMap((platform) =>
    serviceExecutables.flatMap((name) => ({
      name: "service",
      func: () => resolveClashVergeService(platform, name),
      retry: 5,
    }))
  ),
  {
    name: "clash-verge-service-main",
    func: resolveClashVergeServiceCode,
    retry: 5,
  },
  { name: "set-dns-script-main", func: resolveSetDnsScriptCode, retry: 5 },
  { name: "set_dns_script", func: resolveSetDnsScript, retry: 5 },
  { name: "unset_dns_script", func: resolveUnSetDnsScript, retry: 5 },
  { name: "mmdb", func: resolveMmdb, retry: 5 },
  { name: "geosite", func: resolveGeosite, retry: 5 },
  { name: "geoip", func: resolveGeoIP, retry: 5 },
  { name: "enableLoopback", func: resolveEnableLoopback, retry: 5 },
];

async function runTask() {
  for (let task = tasks.shift(); task; task = tasks.shift()) {
    for (let i = 0; i < task.retry; i++) {
      try {
        await task.func();
        break;
      } catch (err) {
        console.error(`[ERROR]: task::${task.name} try ${i} ==`, err.message);
        if (i === task.retry - 1) throw err;
      }
    }
  }
}

runTask();
