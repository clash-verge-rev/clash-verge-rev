import { extract } from "tar";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import AdmZip from "adm-zip";
import { glob } from "glob";
import {
  log_info,
  log_debug,
  log_error,
  log_success,
} from "./utils.mjs";

const cwd = Deno.cwd();
const TEMP_DIR = join(cwd, "node_modules/.verge");
const FORCE = Deno.args.includes("--force");

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

const arg1 = Deno.args[0];
const arg2 = Deno.args[1];
const target = arg1 === "--force" ? arg2 : arg1;
const { platform, arch } = target
  ? { platform: PLATFORM_MAP[target], arch: ARCH_MAP[target] }
  : {
      platform: Deno.build.os,
      arch: Deno.build.arch === "aarch64" ? "arm64" : Deno.build.arch,
    };

const SIDECAR_HOST = await (async () => {
  if (target) return target;
  try {
    const cmd = Deno.run({
      cmd: ["rustc", "-vV"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const text = new TextDecoder().decode(output);
    const match = text.match(/(?<=host: ).+(?=\s*)/g);
    cmd.close();
    if (!match) throw new Error("No host found in rustc output");
    return match[0];
  } catch (error) {
    log_error("Failed to determine SIDECAR_HOST with rustc:", error.message);
    Deno.exit(1);
  }
})();

/* ======= clash meta alpha ======= */
const META_ALPHA_VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt";
const META_ALPHA_URL_PREFIX =
  "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha";
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

// Fetch the latest alpha release version
async function getLatestAlphaVersion() {
  const httpProxy =
    Deno.env.get("HTTP_PROXY") ||
    Deno.env.get("http_proxy") ||
    Deno.env.get("HTTPS_PROXY") ||
    Deno.env.get("https_proxy");

  const options = httpProxy ? { headers: { "Proxy": httpProxy } } : {};
  try {
    const response = await fetch(META_ALPHA_VERSION_URL, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const v = await response.text();
    META_ALPHA_VERSION = v.trim();
    log_info(`Latest alpha version: ${META_ALPHA_VERSION}`);
  } catch (error) {
    log_error("Error fetching latest alpha version:", error.message);
    Deno.exit(1);
  }
}

/* ======= clash meta stable ======= */
const META_VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt";
const META_URL_PREFIX =
  "https://github.com/MetaCubeX/mihomo/releases/download";
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

// Fetch the latest release version
async function getLatestReleaseVersion() {
  const httpProxy =
    Deno.env.get("HTTP_PROXY") ||
    Deno.env.get("http_proxy") ||
    Deno.env.get("HTTPS_PROXY") ||
    Deno.env.get("https_proxy");

  const options = httpProxy ? { headers: { "Proxy": httpProxy } } : {};
  try {
    const response = await fetch(META_VERSION_URL, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const v = await response.text();
    META_VERSION = v.trim();
    log_info(`Latest release version: ${META_VERSION}`);
  } catch (error) {
    log_error("Error fetching latest release version:", error.message);
    Deno.exit(1);
  }
}

/* check available */
if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta unsupported platform "${platform}-${arch}"`);
}

if (!META_ALPHA_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta alpha unsupported platform "${platform}-${arch}"`);
}

/* core info */
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

/* download sidecar and rename */
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, downloadURL } = binInfo;

  const sidecarDir = join(cwd, "src-tauri", "sidecar");
  const sidecarPath = join(sidecarDir, targetFile);

  await Deno.mkdir(sidecarDir, { recursive: true });
  if (!FORCE && (await Deno.stat(sidecarPath).catch(() => null))) return;

  const tempDir = join(TEMP_DIR, name);
  const tempZip = join(tempDir, zipFile);
  const tempExe = join(tempDir, exeFile);

  await Deno.mkdir(tempDir, { recursive: true });
  try {
    if (!(await Deno.stat(tempZip).catch(() => null))) {
      await downloadFile(downloadURL, tempZip);
    }

    if (zipFile.endsWith(".zip")) {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        log_debug(`"${name}" entry name`, entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      await Deno.rename(tempExe, sidecarPath);
      log_success(`unzip finished: "${name}"`);
    } else if (zipFile.endsWith(".tgz")) {
      await Deno.mkdir(tempDir, { recursive: true });
      await extract({ cwd: tempDir, file: tempZip });
      const files = [];
      for await (const entry of Deno.readDir(tempDir)) {
        files.push(entry.name);
      }
      log_debug(`"${name}" files in tempDir:`, files);
      const extractedFile = files.find((file) => file.startsWith("虚空终端-"));
      if (extractedFile) {
        const extractedFilePath = join(tempDir, extractedFile);
        await Deno.rename(extractedFilePath, sidecarPath);
        log_success(`"${name}" file renamed to "${sidecarPath}"`);
        await Deno.run({ cmd: ["chmod", "755", sidecarPath] }).status();
        log_success(`chmod binary finished: "${name}"`);
      } else {
        throw new Error(`Expected file not found in ${tempDir}`);
      }
    } else {
      const data = await Deno.readFile(tempZip);
      const decompressed = await new Promise((resolve, reject) => {
        const chunks = [];
        const gunzip = new DecompressionStream("gzip");
        const stream = new Blob([data]).stream().pipeThrough(gunzip);
        const reader = stream.getReader();
        reader.read().then(function process({ done, value }) {
          if (done) {
            resolve(new Uint8Array(chunks.flat()));
            return;
          }
          chunks.push(value);
          reader.read().then(process);
        }).catch(reject);
      });
      await Deno.writeFile(sidecarPath, decompressed);
      await Deno.run({ cmd: ["chmod", "755", sidecarPath] }).status();
      log_success(`chmod binary finished: "${name}"`);
    }
  } catch (err) {
    await Deno.remove(sidecarPath, { recursive: true }).catch(() => {});
    throw err;
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

const resolveSetDnsScript = () =>
  resolveResource({
    file: "set_dns.sh",
    localPath: join(cwd, "scripts/set_dns.sh"),
  });

const resolveUnSetDnsScript = () =>
  resolveResource({
    file: "unset_dns.sh",
    localPath: join(cwd, "scripts/unset_dns.sh"),
  });

/* download the file to the resources dir */
async function resolveResource(binInfo) {
  const { file, downloadURL, localPath } = binInfo;
  const resDir = join(cwd, "src-tauri/resources");
  const targetPath = join(resDir, file);

  if (!FORCE && (await Deno.stat(targetPath).catch(() => null))) return;

  if (downloadURL) {
    await Deno.mkdir(resDir, { recursive: true });
    await downloadFile(downloadURL, targetPath);
  }

  if (localPath) {
    await Deno.copyFile(localPath, targetPath);
    log_debug(`copy file finished: "${localPath}"`);
  }

  log_success(`${file} finished`);
}

/* download file and save to `path` */
async function downloadFile(url, path) {
  const httpProxy =
    Deno.env.get("HTTP_PROXY") ||
    Deno.env.get("http_proxy") ||
    Deno.env.get("HTTPS_PROXY") ||
    Deno.env.get("https_proxy");

  const options = httpProxy ? { headers: { "Proxy": httpProxy } } : {};
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, "Content-Type": "application/octet-stream" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  await Deno.writeFile(path, new Uint8Array(buffer));
  log_success(`download finished: ${url}`);
}

/* SimpleSC.dll */
async function resolvePlugin() {
  const url =
    "https://nsis.sourceforge.io/mediawiki/images/e/ef/NSIS_Simple_Service_Plugin_Unicode_1.30.zip";

  const tempDir = join(TEMP_DIR, "SimpleSC");
  const tempZip = join(tempDir, "NSIS_Simple_Service_Plugin_Unicode_1.30.zip");
  const tempDll = join(tempDir, "SimpleSC.dll");
  const pluginDir = join(Deno.env.get("APPDATA") || Deno.cwd(), "Local/NSIS");
  const pluginPath = join(pluginDir, "SimpleSC.dll");

  await Deno.mkdir(pluginDir, { recursive: true });
  await Deno.mkdir(tempDir, { recursive: true });
  if (!FORCE && (await Deno.stat(pluginPath).catch(() => null))) return;

  try {
    if (!(await Deno.stat(tempZip).catch(() => null))) {
      await downloadFile(url, tempZip);
    }
    const zip = new AdmZip(tempZip);
    zip.getEntries().forEach((entry) => {
      log_debug(`"SimpleSC" entry name`, entry.entryName);
    });
    zip.extractAllTo(tempDir, true);
    await Deno.copyFile(tempDll, pluginPath);
    log_success(`unzip finished: "SimpleSC"`);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

/* service chmod */
async function resolveServicePermission() {
  const serviceExecutables = [
    "clash-verge-service*",
    "install-service*",
    "uninstall-service*",
  ];
  const resDir = join(cwd, "src-tauri/resources");
  for (const pattern of serviceExecutables) {
    const files = glob.sync(join(resDir, pattern));
    for (const filePath of files) {
      if (await Deno.stat(filePath).catch(() => null)) {
        await Deno.run({ cmd: ["chmod", "755", filePath] }).status();
        log_success(`chmod finished: "${filePath}"`);
      }
    }
  }
}

/* copy locale files */
async function resolveLocales() {
  const srcLocalesDir = join(cwd, "src/locales");
  const targetLocalesDir = join(cwd, "src-tauri/resources/locales");

  try {
    await Deno.mkdir(targetLocalesDir, { recursive: true });
    const files = [];
    for await (const entry of Deno.readDir(srcLocalesDir)) {
      files.push(entry.name);
    }
    for (const file of files) {
      const srcPath = join(srcLocalesDir, file);
      const targetPath = join(targetLocalesDir, file);
      await Deno.copyFile(srcPath, targetPath);
      log_success(`Copied locale file: ${file}`);
    }
    log_success("All locale files copied successfully");
  } catch (err) {
    log_error("Error copying locale files:", err.message);
    throw err;
  }
}

/* main */
const SERVICE_URL = `https://github.com/clash-verge-rev/clash-verge-service/releases/download/${SIDECAR_HOST}`;

const resolveService = () => {
  const ext = platform === "win32" ? ".exe" : "";
  const suffix = platform === "linux" ? "-" + SIDECAR_HOST : "";
  resolveResource({
    file: "clash-verge-service" + suffix + ext,
    downloadURL: `${SERVICE_URL}/clash-verge-service${ext}`,
  });
};

const resolveInstall = () => {
  const ext = platform === "win32" ? ".exe" : "";
  const suffix = platform === "linux" ? "-" + SIDECAR_HOST : "";
  resolveResource({
    file: "install-service" + suffix + ext,
    downloadURL: `${SERVICE_URL}/install-service${ext}`,
  });
};

const resolveUninstall = () => {
  const ext = platform === "win32" ? ".exe" : "";
  const suffix = platform === "linux" ? "-" + SIDECAR_HOST : "";
  resolveResource({
    file: "uninstall-service" + suffix + ext,
    downloadURL: `${SERVICE_URL}/uninstall-service${ext}`,
  });
};

const resolveMmdb = () =>
  resolveResource({
    file: "Country.mmdb",
    downloadURL:
      "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb",
  });

const resolveGeosite = () =>
  resolveResource({
    file: "geosite.dat",
    downloadURL:
      "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
  });

const resolveGeoIP = () =>
  resolveResource({
    file: "geoip.dat",
    downloadURL:
      "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat",
  });

const resolveEnableLoopback = () =>
  resolveResource({
    file: "enableLoopback.exe",
    downloadURL:
      "https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe",
  });

const resolveWinSysproxy = () =>
  resolveResource({
    file: "sysproxy.exe",
    downloadURL:
      `https://github.com/clash-verge-rev/sysproxy/releases/download/${arch}/sysproxy.exe`,
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