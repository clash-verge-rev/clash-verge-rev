import { execSync } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import zlib from 'zlib'

import AdmZip from 'adm-zip'
import { glob } from 'glob'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fetch from 'node-fetch'
import { extract } from 'tar'

import { log_debug, log_error, log_info, log_success } from './utils.mjs'

/**
 * Prebuild script with optimization features:
 * 1. Skip downloading mihomo core if it already exists (unless --force is used)
 * 2. Cache version information for 1 hour to avoid repeated version checks
 * 3. Use file hash to detect changes and skip unnecessary chmod/copy operations
 * 4. Use --force or -f flag to force re-download and update all resources
 * 5. Service binary version-aware: re-download when IPC crate version changes
 *
 */

const cwd = process.cwd()
const TEMP_DIR = path.join(cwd, 'node_modules/.verge')
const FORCE = process.argv.includes('--force') || process.argv.includes('-f')
const VERSION_CACHE_FILE = path.join(TEMP_DIR, '.version_cache.json')
const HASH_CACHE_FILE = path.join(TEMP_DIR, '.hash_cache.json')
/** 记录上次下载 service binary 时对应的 IPC crate 版本 */
const SERVICE_VERSION_FILE = path.join(TEMP_DIR, '.service_ipc_version.json')

const PLATFORM_MAP = {
  'x86_64-pc-windows-msvc': 'win32',
  'i686-pc-windows-msvc': 'win32',
  'aarch64-pc-windows-msvc': 'win32',
  'x86_64-apple-darwin': 'darwin',
  'aarch64-apple-darwin': 'darwin',
  'x86_64-unknown-linux-gnu': 'linux',
  'i686-unknown-linux-gnu': 'linux',
  'aarch64-unknown-linux-gnu': 'linux',
  'armv7-unknown-linux-gnueabihf': 'linux',
  'riscv64gc-unknown-linux-gnu': 'linux',
  'loongarch64-unknown-linux-gnu': 'linux',
}
const ARCH_MAP = {
  'x86_64-pc-windows-msvc': 'x64',
  'i686-pc-windows-msvc': 'ia32',
  'aarch64-pc-windows-msvc': 'arm64',
  'x86_64-apple-darwin': 'x64',
  'aarch64-apple-darwin': 'arm64',
  'x86_64-unknown-linux-gnu': 'x64',
  'i686-unknown-linux-gnu': 'ia32',
  'aarch64-unknown-linux-gnu': 'arm64',
  'armv7-unknown-linux-gnueabihf': 'arm',
  'riscv64gc-unknown-linux-gnu': 'riscv64',
  'loongarch64-unknown-linux-gnu': 'loong64',
}

const arg1 = process.argv.slice(2)[0]
const arg2 = process.argv.slice(2)[1]
const target = arg1 === '--force' || arg1 === '-f' ? arg2 : arg1
const { platform, arch } = target
  ? { platform: PLATFORM_MAP[target], arch: ARCH_MAP[target] }
  : process

const SIDECAR_HOST = target
  ? target
  : execSync('rustc -vV')
      .toString()
      .match(/(?<=host: ).+(?=\s*)/g)[0]

const RESOURCES_DIR = path.join(cwd, 'src-tauri', 'resources')
const SIDECAR_DIR = path.join(cwd, 'src-tauri', 'sidecar')
// Linux service binaries are bundled as externalBin sidecars (see tauri.linux.conf.json)
const SERVICE_DIR = platform === 'linux' ? SIDECAR_DIR : RESOURCES_DIR

// =======================
// Version Cache
// =======================
async function loadVersionCache() {
  try {
    if (fs.existsSync(VERSION_CACHE_FILE)) {
      const data = await fsp.readFile(VERSION_CACHE_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    log_debug('Failed to load version cache:', err.message)
  }
  return {}
}
async function saveVersionCache(cache) {
  try {
    await fsp.mkdir(TEMP_DIR, { recursive: true })
    await fsp.writeFile(VERSION_CACHE_FILE, JSON.stringify(cache, null, 2))
    log_debug('Version cache saved')
  } catch (err) {
    log_debug('Failed to save version cache:', err.message)
  }
}
async function getCachedVersion(key) {
  const cache = await loadVersionCache()
  const cached = cache[key]
  if (cached && Date.now() - cached.timestamp < 3600000) {
    log_info(`Using cached version for ${key}: ${cached.version}`)
    return cached.version
  }
  return null
}
async function setCachedVersion(key, version) {
  const cache = await loadVersionCache()
  cache[key] = { version, timestamp: Date.now() }
  await saveVersionCache(cache)
}

// =======================
// Hash Cache & File Hash
// =======================
async function calculateFileHash(filePath) {
  try {
    const fileBuffer = await fsp.readFile(filePath)
    const hashSum = createHash('sha256')
    hashSum.update(fileBuffer)
    return hashSum.digest('hex')
  } catch (ignoreErr) {
    return null
  }
}
async function loadHashCache() {
  try {
    if (fs.existsSync(HASH_CACHE_FILE)) {
      const data = await fsp.readFile(HASH_CACHE_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    log_debug('Failed to load hash cache:', err.message)
  }
  return {}
}
async function saveHashCache(cache) {
  try {
    await fsp.mkdir(TEMP_DIR, { recursive: true })
    await fsp.writeFile(HASH_CACHE_FILE, JSON.stringify(cache, null, 2))
    log_debug('Hash cache saved')
  } catch (err) {
    log_debug('Failed to save hash cache:', err.message)
  }
}
async function hasFileChanged(filePath, targetPath) {
  if (FORCE) return true
  if (!fs.existsSync(targetPath)) return true
  const hashCache = await loadHashCache()
  const sourceHash = await calculateFileHash(filePath)
  const targetHash = await calculateFileHash(targetPath)
  if (!sourceHash || !targetHash) return true
  const cacheKey = targetPath
  const cachedHash = hashCache[cacheKey]
  if (cachedHash === sourceHash && sourceHash === targetHash) {
    return false
  }
  return true
}
async function updateHashCache(targetPath) {
  const hashCache = await loadHashCache()
  const hash = await calculateFileHash(targetPath)
  if (hash) {
    hashCache[targetPath] = hash
    await saveHashCache(hashCache)
  }
}

/**
 * 清除指定文件的 chmod 缓存，确保文件被重新下载后 resolveServicePermission 能重新执行 chmod
 * @param {string} targetPath - 目标文件路径
 */
async function invalidateChmodCache(targetPath) {
  const hashCache = await loadHashCache()
  const cacheKey = `${targetPath}_chmod`
  if (cacheKey in hashCache) {
    delete hashCache[cacheKey]
    await saveHashCache(hashCache)
    log_debug(`Invalidated chmod cache for: ${path.basename(targetPath)}`)
  }
}

// =======================
// Service IPC version check
// =======================

/**
 * 从根目录 Cargo.lock 中解析 clash_verge_service_ipc 的版本号
 * @returns {string|null} 版本号，如 "2.2.0"，解析失败返回 null
 */
function getServiceIpcVersionFromCargoLock() {
  const cargoLockPath = path.join(cwd, 'Cargo.lock')
  try {
    const content = fs.readFileSync(cargoLockPath, 'utf-8')
    // 匹配 [[package]] 块中 name = "clash_verge_service_ipc" 紧跟的 version 字段
    // 用 [\r\n]+ 兼容 Windows（CRLF）和 Unix（LF）换行格式
    const match = content.match(
      /name\s*=\s*"clash_verge_service_ipc"\s*[\r\n]+version\s*=\s*"([^"]+)"/,
    )
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * 保存当前 service binary 对应的 IPC 版本
 * @param {string} version
 */
async function saveServiceIpcVersion(version) {
  await fsp.mkdir(TEMP_DIR, { recursive: true })
  await fsp.writeFile(SERVICE_VERSION_FILE, JSON.stringify({ version }))
}

/**
 * 判断 service binary 是否需要因 IPC 版本变更而强制重新下载
 * @returns {boolean}
 */
function isServiceBinaryOutdated() {
  const expected = getServiceIpcVersionFromCargoLock()
  if (!expected) {
    log_debug(
      'Cannot read service IPC version from Cargo.lock, skipping version check',
    )
    return false
  }
  // 同步读取已记录版本（prebuild 启动阶段调用，避免 async 传染）
  // 文件不存在或解析失败均视为需要重新下载
  try {
    const recorded = JSON.parse(
      fs.readFileSync(SERVICE_VERSION_FILE, 'utf-8'),
    ).version
    if (recorded !== expected) {
      log_info(
        `Service IPC version changed: ${recorded} → ${expected}, forcing re-download`,
      )
      return true
    }
    return false
  } catch {
    return true
  }
}

/** 当前 Cargo.lock 中的 service IPC 期望版本 */
const SERVICE_IPC_VERSION = getServiceIpcVersionFromCargoLock()
/** service binary 是否因版本变更需要强制重下 */
const SERVICE_BINARY_OUTDATED = isServiceBinaryOutdated()

// =======================
// Meta maps (stable & alpha)
// =======================
const META_ALPHA_VERSION_URL =
  'https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt'
const META_ALPHA_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha`
let META_ALPHA_VERSION

const META_VERSION_URL =
  'https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt'
const META_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download`
let META_VERSION

const META_ALPHA_MAP = {
  'win32-x64': 'mihomo-windows-amd64-v2',
  'win32-ia32': 'mihomo-windows-386',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-v1-go122',
  'darwin-arm64': 'mihomo-darwin-arm64-go122',
  'linux-x64': 'mihomo-linux-amd64-v2',
  'linux-ia32': 'mihomo-linux-386',
  'linux-arm64': 'mihomo-linux-arm64',
  'linux-arm': 'mihomo-linux-armv7',
  'linux-riscv64': 'mihomo-linux-riscv64',
  'linux-loong64': 'mihomo-linux-loong64',
}

const META_MAP = {
  'win32-x64': 'mihomo-windows-amd64-v2',
  'win32-ia32': 'mihomo-windows-386',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-v2-go122',
  'darwin-arm64': 'mihomo-darwin-arm64-go122',
  'linux-x64': 'mihomo-linux-amd64-v2',
  'linux-ia32': 'mihomo-linux-386',
  'linux-arm64': 'mihomo-linux-arm64',
  'linux-arm': 'mihomo-linux-armv7',
  'linux-riscv64': 'mihomo-linux-riscv64',
  'linux-loong64': 'mihomo-linux-loong64',
}

// =======================
// Fetch latest versions
// =======================
async function getLatestAlphaVersion() {
  if (!FORCE) {
    const cached = await getCachedVersion('META_ALPHA_VERSION')
    if (cached) {
      META_ALPHA_VERSION = cached
      return
    }
  }
  const options = {}
  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy
  if (httpProxy) options.agent = new HttpsProxyAgent(httpProxy)

  try {
    const response = await fetch(META_ALPHA_VERSION_URL, {
      ...options,
      method: 'GET',
    })
    if (!response.ok)
      throw new Error(
        `Failed to fetch ${META_ALPHA_VERSION_URL}: ${response.status}`,
      )
    META_ALPHA_VERSION = (await response.text()).trim()
    log_info(`Latest alpha version: ${META_ALPHA_VERSION}`)
    await setCachedVersion('META_ALPHA_VERSION', META_ALPHA_VERSION)
  } catch (err) {
    log_error('Error fetching latest alpha version:', err.message)
    process.exit(1)
  }
}

async function getLatestReleaseVersion() {
  if (!FORCE) {
    const cached = await getCachedVersion('META_VERSION')
    if (cached) {
      META_VERSION = cached
      return
    }
  }
  const options = {}
  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy
  if (httpProxy) options.agent = new HttpsProxyAgent(httpProxy)

  try {
    const response = await fetch(META_VERSION_URL, {
      ...options,
      method: 'GET',
    })
    if (!response.ok)
      throw new Error(`Failed to fetch ${META_VERSION_URL}: ${response.status}`)
    META_VERSION = (await response.text()).trim()
    log_info(`Latest release version: ${META_VERSION}`)
    await setCachedVersion('META_VERSION', META_VERSION)
  } catch (err) {
    log_error('Error fetching latest release version:', err.message)
    process.exit(1)
  }
}

// =======================
// Validate availability
// =======================
if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta unsupported platform "${platform}-${arch}"`)
}
if (!META_ALPHA_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta alpha unsupported platform "${platform}-${arch}"`)
}

// =======================
// Build meta objects
// =======================
function clashMetaAlpha() {
  const name = META_ALPHA_MAP[`${platform}-${arch}`]
  const isWin = platform === 'win32'
  const urlExt = isWin ? 'zip' : 'gz'
  return {
    name: 'verge-mihomo-alpha',
    targetFile: `verge-mihomo-alpha-${SIDECAR_HOST}${isWin ? '.exe' : ''}`,
    exeFile: `${name}${isWin ? '.exe' : ''}`,
    zipFile: `${name}-${META_ALPHA_VERSION}.${urlExt}`,
    downloadURL: `${META_ALPHA_URL_PREFIX}/${name}-${META_ALPHA_VERSION}.${urlExt}`,
  }
}

function clashMeta() {
  const name = META_MAP[`${platform}-${arch}`]
  const isWin = platform === 'win32'
  const urlExt = isWin ? 'zip' : 'gz'
  return {
    name: 'verge-mihomo',
    targetFile: `verge-mihomo-${SIDECAR_HOST}${isWin ? '.exe' : ''}`,
    exeFile: `${name}${isWin ? '.exe' : ''}`,
    zipFile: `${name}-${META_VERSION}.${urlExt}`,
    downloadURL: `${META_URL_PREFIX}/${META_VERSION}/${name}-${META_VERSION}.${urlExt}`,
  }
}

// =======================
// download helper (增强：status + magic bytes)
// =======================
async function downloadFile(url, outPath) {
  const options = {}
  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy
  if (httpProxy) options.agent = new HttpsProxyAgent(httpProxy)

  const response = await fetch(url, {
    ...options,
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // 将 body 写到文件以便排查（可通过临时目录查看）
    await fsp.mkdir(path.dirname(outPath), { recursive: true })
    await fsp.writeFile(outPath, body)
    throw new Error(`Failed to download ${url}: status ${response.status}`)
  }

  const buf = Buffer.from(await response.arrayBuffer())
  await fsp.mkdir(path.dirname(outPath), { recursive: true })

  // 简单 magic 字节检查
  if (url.endsWith('.gz') || url.endsWith('.tgz')) {
    if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
      await fsp.writeFile(outPath, buf)
      throw new Error(
        `Downloaded file for ${url} is not a valid gzip (magic mismatch).`,
      )
    }
  } else if (url.endsWith('.zip')) {
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
      await fsp.writeFile(outPath, buf)
      throw new Error(
        `Downloaded file for ${url} is not a valid zip (magic mismatch).`,
      )
    }
  }

  await fsp.writeFile(outPath, buf)
  log_success(`download finished: ${url}`)
}

// =======================
// resolveSidecar (支持 zip / tgz / gz)
// =======================
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, downloadURL } = binInfo
  const sidecarPath = path.join(SIDECAR_DIR, targetFile)
  await fsp.mkdir(SIDECAR_DIR, { recursive: true })

  if (!FORCE && fs.existsSync(sidecarPath)) {
    log_success(`"${name}" already exists, skipping download`)
    return
  }

  const tempDir = path.join(TEMP_DIR, name)
  const tempZip = path.join(tempDir, zipFile)
  const tempExe = path.join(tempDir, exeFile)
  await fsp.mkdir(tempDir, { recursive: true })

  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(downloadURL, tempZip)
    }

    if (zipFile.endsWith('.zip')) {
      const zip = new AdmZip(tempZip)
      zip.getEntries().forEach((entry) => {
        log_debug(`"${name}" entry: ${entry.entryName}`)
      })
      zip.extractAllTo(tempDir, true)
      // 尝试按 exeFile 重命名，否则找第一个可执行文件
      if (fs.existsSync(tempExe)) {
        await fsp.rename(tempExe, sidecarPath)
      } else {
        // 搜索候选
        const files = await fsp.readdir(tempDir)
        const candidate = files.find(
          (f) =>
            f === path.basename(exeFile) ||
            f.endsWith('.exe') ||
            !f.includes('.'),
        )
        if (!candidate)
          throw new Error(`Expected binary not found in ${tempDir}`)
        await fsp.rename(path.join(tempDir, candidate), sidecarPath)
      }
      if (platform !== 'win32') execSync(`chmod 755 ${sidecarPath}`)
      log_success(`unzip finished: "${name}"`)
    } else if (zipFile.endsWith('.tgz')) {
      await extract({ cwd: tempDir, file: tempZip })
      const files = await fsp.readdir(tempDir)
      log_debug(`"${name}" extracted files:`, files)
      // 优先寻找给定 exeFile 或已知前缀
      let extracted = files.find(
        (f) =>
          f === path.basename(exeFile) ||
          f.startsWith('虚空终端-') ||
          !f.includes('.'),
      )
      if (!extracted) extracted = files[0]
      if (!extracted) throw new Error(`Expected file not found in ${tempDir}`)
      await fsp.rename(path.join(tempDir, extracted), sidecarPath)
      execSync(`chmod 755 ${sidecarPath}`)
      log_success(`tgz processed: "${name}"`)
    } else {
      // .gz
      const readStream = fs.createReadStream(tempZip)
      const writeStream = fs.createWriteStream(sidecarPath)
      await new Promise((resolve, reject) => {
        readStream
          .pipe(zlib.createGunzip())
          .on('error', (e) => {
            log_error(`gunzip error for ${name}:`, e.message)
            reject(e)
          })
          .pipe(writeStream)
          .on('finish', () => {
            if (platform !== 'win32') execSync(`chmod 755 ${sidecarPath}`)
            resolve()
          })
          .on('error', (e) => {
            log_error(`write stream error for ${name}:`, e.message)
            reject(e)
          })
      })
      log_success(`gz binary processed: "${name}"`)
    }
  } catch (err) {
    await fsp.rm(sidecarPath, { recursive: true, force: true })
    throw err
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

async function resolveResource(binInfo) {
  const { file, downloadURL, localPath, dir } = binInfo
  const baseDir = dir ?? RESOURCES_DIR
  const targetPath = path.join(baseDir, file)

  if (!FORCE && fs.existsSync(targetPath) && !downloadURL && !localPath) {
    log_success(`"${file}" already exists, skipping`)
    return
  }

  if (downloadURL) {
    if (!FORCE && fs.existsSync(targetPath)) {
      log_success(`"${file}" already exists, skipping download`)
      return
    }
    await fsp.mkdir(baseDir, { recursive: true })
    await downloadFile(downloadURL, targetPath)
    await updateHashCache(targetPath)
    // 下载会覆盖写入并重置文件权限，需要清除 _chmod 缓存，
    // 确保 resolveServicePermission 在后续步骤中重新应用 chmod
    await invalidateChmodCache(targetPath)
  }

  if (localPath) {
    if (!(await hasFileChanged(localPath, targetPath))) {
      return
    }
    await fsp.mkdir(baseDir, { recursive: true })
    await fsp.copyFile(localPath, targetPath)
    await updateHashCache(targetPath)
    log_success(`Copied file: ${file}`)
  }

  log_success(`${file} finished`)
}

// SimpleSC.dll (win plugin)
const resolvePlugin = async () => {
  const url =
    'https://nsis.sourceforge.io/mediawiki/images/e/ef/NSIS_Simple_Service_Plugin_Unicode_1.30.zip'
  const tempDir = path.join(TEMP_DIR, 'SimpleSC')
  const tempZip = path.join(
    tempDir,
    'NSIS_Simple_Service_Plugin_Unicode_1.30.zip',
  )
  const tempDll = path.join(tempDir, 'SimpleSC.dll')
  const pluginDir = path.join(process.env.APPDATA || '', 'Local/NSIS')
  const pluginPath = path.join(pluginDir, 'SimpleSC.dll')
  await fsp.mkdir(pluginDir, { recursive: true })
  await fsp.mkdir(tempDir, { recursive: true })
  if (!FORCE && fs.existsSync(pluginPath)) return
  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(url, tempZip)
    }
    const zip = new AdmZip(tempZip)
    zip
      .getEntries()
      .forEach((entry) => log_debug(`"SimpleSC" entry`, entry.entryName))
    zip.extractAllTo(tempDir, true)
    if (fs.existsSync(tempDll)) {
      await fsp.cp(tempDll, pluginPath, { recursive: true, force: true })
      log_success(`unzip finished: "SimpleSC"`)
    } else {
      // 如果 dll 名称不同，尝试找到 dll
      const files = await fsp.readdir(tempDir)
      const dll = files.find((f) => f.toLowerCase().endsWith('.dll'))
      if (dll) {
        await fsp.cp(path.join(tempDir, dll), pluginPath, {
          recursive: true,
          force: true,
        })
        log_success(`unzip finished: "SimpleSC" (found ${dll})`)
      } else {
        throw new Error('SimpleSC.dll not found in zip')
      }
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

// service chmod (保留并使用 glob)
const resolveServicePermission = async () => {
  const serviceExecutables = [
    'clash-verge-service*',
    'clash-verge-service-install*',
    'clash-verge-service-uninstall*',
  ]
  const hashCache = await loadHashCache()
  let hasChanges = false

  for (const f of serviceExecutables) {
    const files = glob.sync(path.join(SERVICE_DIR, f))
    for (const filePath of files) {
      if (fs.existsSync(filePath)) {
        const currentHash = await calculateFileHash(filePath)
        const cacheKey = `${filePath}_chmod`
        if (!FORCE && hashCache[cacheKey] === currentHash) {
          continue
        }
        try {
          execSync(`chmod 755 ${filePath}`)
          log_success(`chmod finished: "${filePath}"`)
        } catch (e) {
          log_error(`chmod failed for ${filePath}:`, e.message)
        }
        hashCache[cacheKey] = currentHash
        hasChanges = true
      }
    }
  }

  if (hasChanges) {
    await saveHashCache(hashCache)
  }
}

// =======================
// Other resource resolvers (service, mmdb, geosite, geoip, enableLoopback)
// =======================
const SERVICE_URL = `https://github.com/clash-verge-rev/clash-verge-service-ipc/releases/download/${SIDECAR_HOST}`

/**
 * 下载主 service binary。
 * 若检测到 IPC 版本变更（SERVICE_BINARY_OUTDATED），先删除三个旧 binary 以触发
 * resolveInstall / resolveUninstall 强制重下；IPC 版本写入由独立任务 service_ipc_version 负责。
 */
const resolveService = async () => {
  const ext = platform === 'win32' ? '.exe' : ''
  const suffix = platform === 'linux' ? '-' + SIDECAR_HOST : ''
  // IPC 版本变更时，删除旧 binary 以触发 resolveResource 强制重下
  if (!FORCE && SERVICE_BINARY_OUTDATED) {
    const targets = [
      path.join(SERVICE_DIR, `clash-verge-service${suffix}${ext}`),
      path.join(SERVICE_DIR, `clash-verge-service-install${suffix}${ext}`),
      path.join(SERVICE_DIR, `clash-verge-service-uninstall${suffix}${ext}`),
    ]
    for (const t of targets) {
      if (fs.existsSync(t)) {
        await fsp.rm(t, { force: true })
        log_info(`Removed outdated service binary: ${path.basename(t)}`)
      }
    }
  }
  await resolveResource({
    file: 'clash-verge-service' + suffix + ext,
    dir: SERVICE_DIR,
    downloadURL: `${SERVICE_URL}/clash-verge-service${ext}`,
  })
}

const resolveInstall = () => {
  const ext = platform === 'win32' ? '.exe' : ''
  const suffix = platform === 'linux' ? '-' + SIDECAR_HOST : ''
  return resolveResource({
    file: 'clash-verge-service-install' + suffix + ext,
    dir: SERVICE_DIR,
    downloadURL: `${SERVICE_URL}/clash-verge-service-install${ext}`,
  })
}
const resolveUninstall = () => {
  const ext = platform === 'win32' ? '.exe' : ''
  const suffix = platform === 'linux' ? '-' + SIDECAR_HOST : ''
  return resolveResource({
    file: 'clash-verge-service-uninstall' + suffix + ext,
    dir: SERVICE_DIR,
    downloadURL: `${SERVICE_URL}/clash-verge-service-uninstall${ext}`,
  })
}

const resolveMmdb = () =>
  resolveResource({
    file: 'Country.mmdb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb`,
  })
const resolveGeosite = () =>
  resolveResource({
    file: 'geosite.dat',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`,
  })
const resolveGeoIP = () =>
  resolveResource({
    file: 'geoip.dat',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`,
  })
const resolveEnableLoopback = () =>
  resolveResource({
    file: 'enableLoopback.exe',
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`,
  })

const resolveSetDnsScript = () =>
  resolveResource({
    file: 'set_dns.sh',
    localPath: path.join(cwd, 'scripts/set_dns.sh'),
  })
const resolveUnSetDnsScript = () =>
  resolveResource({
    file: 'unset_dns.sh',
    localPath: path.join(cwd, 'scripts/unset_dns.sh'),
  })

// =======================
// Tasks
// =======================
const tasks = [
  {
    name: 'verge-mihomo-alpha',
    func: () =>
      getLatestAlphaVersion().then(() => resolveSidecar(clashMetaAlpha())),
    retry: 5,
  },
  {
    name: 'verge-mihomo',
    func: () =>
      getLatestReleaseVersion().then(() => resolveSidecar(clashMeta())),
    retry: 5,
  },
  { name: 'plugin', func: resolvePlugin, retry: 5, winOnly: true },
  { name: 'service', func: resolveService, retry: 5 },
  { name: 'install', func: resolveInstall, retry: 5 },
  { name: 'uninstall', func: resolveUninstall, retry: 5 },
  {
    // 三个 service binary 全部下载成功后，记录当前 IPC 版本供下次比对
    name: 'service_ipc_version',
    func: async () => {
      if (SERVICE_IPC_VERSION) {
        await saveServiceIpcVersion(SERVICE_IPC_VERSION)
      }
    },
    retry: 1,
  },
  { name: 'mmdb', func: resolveMmdb, retry: 5 },
  { name: 'geosite', func: resolveGeosite, retry: 5 },
  { name: 'geoip', func: resolveGeoIP, retry: 5 },
  {
    name: 'enableLoopback',
    func: resolveEnableLoopback,
    retry: 5,
    winOnly: true,
  },
  {
    name: 'service_chmod',
    func: resolveServicePermission,
    retry: 5,
    unixOnly: platform === 'linux' || platform === 'darwin',
  },
  {
    name: 'set_dns_script',
    func: resolveSetDnsScript,
    retry: 5,
    macosOnly: true,
  },
  {
    name: 'unset_dns_script',
    func: resolveUnSetDnsScript,
    retry: 5,
    macosOnly: true,
  },
]

async function runTask() {
  const task = tasks.shift()
  if (!task) return
  if (task.unixOnly && platform === 'win32') return runTask()
  if (task.winOnly && platform !== 'win32') return runTask()
  if (task.macosOnly && platform !== 'darwin') return runTask()
  if (task.linuxOnly && platform !== 'linux') return runTask()

  for (let i = 0; i < task.retry; i++) {
    try {
      await task.func()
      break
    } catch (err) {
      log_error(`task::${task.name} try ${i} ==`, err.message)
      if (i === task.retry - 1) throw err
    }
  }
  return runTask()
}

runTask()
