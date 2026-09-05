/**
 * CLI tool to update version numbers in package.json, src-tauri/Cargo.toml, and src-tauri/tauri.conf.json.
 *
 * Usage:
 *   pnpm release-version <version>
 *
 * <version> can be:
 *   - A full semver version (e.g., 1.2.3, v1.2.3, 1.2.3-beta, v1.2.3+build)
 *   - A tag: "alpha", "beta", "rc", "autobuild", "autobuild-latest", or "deploytest"
 *     - "alpha", "beta", "rc": Appends the tag to the current base version (e.g., 1.2.3-beta)
 *     - "autobuild": Appends a timestamped autobuild tag (e.g., 1.2.3+autobuild.2406101530)
 *     - "autobuild-latest": Appends an autobuild tag with latest Tauri commit (e.g., 1.2.3+autobuild.0614.a1b2c3d)
 *     - "deploytest": Appends a timestamped deploytest tag (e.g., 1.2.3+deploytest.2406101530)
 *
 * Examples:
 *   pnpm release-version 1.2.3
 *   pnpm release-version v1.2.3-beta
 *   pnpm release-version beta
 *   pnpm release-version autobuild
 *   pnpm release-version autobuild-latest
 *   pnpm release-version deploytest
 *
 */

import { execSync } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

import { program } from 'commander'

function getGitShortCommit() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    console.warn("[WARN]: Failed to get git short commit, fallback to 'nogit'")
    return 'nogit'
  }
}

function getLatestTauriCommit() {
  try {
    const fullHash = execSync(
      'bash ./scripts-workflow/get_latest_tauri_commit.bash',
    )
      .toString()
      .trim()
    const shortHash = execSync(`git rev-parse --short ${fullHash}`)
      .toString()
      .trim()
    console.log(`[INFO]: Latest Tauri-related commit: ${shortHash}`)
    return shortHash
  } catch (error) {
    console.warn(
      '[WARN]: Failed to get latest Tauri commit, fallback to current git short commit',
    )
    console.warn(`[WARN]: Error details: ${error.message}`)
    return getGitShortCommit()
  }
}

/**
 * 生成短时间戳 (格式: YYYYMMDD)
 * 使用 Asia/Shanghai 时区
 * @returns {string}
 */
function generateShortTimestamp() {
  const now = new Date()

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(now)
  const year = parts.find((part) => part.type === 'year').value
  const month = parts.find((part) => part.type === 'month').value
  const day = parts.find((part) => part.type === 'day').value

  return `${year}${month}${day}`
}

function isValidVersion(version) {
  return /^v?\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/i.test(
    version,
  )
}

function normalizeVersion(version) {
  return version.startsWith('v') ? version : `v${version}`
}

function getBaseVersion(version) {
  let base = version.replace(/-(alpha|beta|rc)(\.\d+)?/i, '')
  base = base.replace(/\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*/g, '')
  return base
}

async function updatePackageVersion(newVersion) {
  const _dirname = process.cwd()
  const packageJsonPath = path.join(_dirname, 'package.json')
  try {
    const data = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(data)

    console.log(
      '[INFO]: Current package.json version is: ',
      packageJson.version,
    )
    packageJson.version = newVersion.startsWith('v')
      ? newVersion.slice(1)
      : newVersion
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      'utf8',
    )
    console.log(
      `[INFO]: package.json version updated to: ${packageJson.version}`,
    )
  } catch (error) {
    console.error('Error updating package.json version:', error)
    throw error
  }
}

async function updateCargoVersion(newVersion) {
  const _dirname = process.cwd()
  const cargoTomlPath = path.join(_dirname, 'src-tauri', 'Cargo.toml')
  try {
    const data = await fs.readFile(cargoTomlPath, 'utf8')
    const lines = data.split('\n')
    const versionWithoutV = newVersion.startsWith('v')
      ? newVersion.slice(1)
      : newVersion

    const updatedLines = lines.map((line) => {
      if (line.trim().startsWith('version =')) {
        return line.replace(
          /version\s*=\s*"[^"]+"/,
          `version = "${versionWithoutV}"`,
        )
      }
      return line
    })

    await fs.writeFile(cargoTomlPath, updatedLines.join('\n'), 'utf8')
    console.log(`[INFO]: Cargo.toml version updated to: ${versionWithoutV}`)
  } catch (error) {
    console.error('Error updating Cargo.toml version:', error)
    throw error
  }
}

async function updateTauriConfigVersion(newVersion) {
  const _dirname = process.cwd()
  const tauriConfigPath = path.join(_dirname, 'src-tauri', 'tauri.conf.json')
  try {
    const data = await fs.readFile(tauriConfigPath, 'utf8')
    const tauriConfig = JSON.parse(data)
    const versionWithoutV = newVersion.startsWith('v')
      ? newVersion.slice(1)
      : newVersion

    console.log(
      '[INFO]: Current tauri.conf.json version is: ',
      tauriConfig.version,
    )

    tauriConfig.version = versionWithoutV

    await fs.writeFile(
      tauriConfigPath,
      JSON.stringify(tauriConfig, null, 2),
      'utf8',
    )
    console.log(
      `[INFO]: tauri.conf.json version updated to: ${versionWithoutV}`,
    )
  } catch (error) {
    console.error('Error updating tauri.conf.json version:', error)
    throw error
  }
}

async function getCurrentVersion() {
  const _dirname = process.cwd()
  const packageJsonPath = path.join(_dirname, 'package.json')
  try {
    const data = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(data)
    return packageJson.version
  } catch (error) {
    console.error('Error getting current version:', error)
    throw error
  }
}

async function main(versionArg) {
  if (!versionArg) {
    console.error('Error: Version argument is required')
    process.exit(1)
  }

  try {
    let newVersion
    const validTags = [
      'alpha',
      'beta',
      'rc',
      'autobuild',
      'autobuild-latest',
      'deploytest',
    ]

    if (validTags.includes(versionArg.toLowerCase())) {
      const currentVersion = await getCurrentVersion()
      const baseVersion = getBaseVersion(currentVersion)
      const latestTauriCommit = getLatestTauriCommit()

      if (versionArg.toLowerCase() === 'autobuild') {
        // 格式: 2.3.0-autobuild.20251004+cc39b27
        // 使用 Tauri 相关的最新 commit hash
        newVersion = `${baseVersion}-autobuild.${generateShortTimestamp()}+${latestTauriCommit}`
      } else if (versionArg.toLowerCase() === 'autobuild-latest') {
        // 格式: 2.3.0-autobuild.20251004+a1b2c3d (使用最新 Tauri 提交)
        newVersion = `${baseVersion}-autobuild.${generateShortTimestamp()}+${latestTauriCommit}`
      } else if (versionArg.toLowerCase() === 'deploytest') {
        // 格式: 2.3.0-deploytest.20251004+cc39b27
        // 使用 Tauri 相关的最新 commit hash
        newVersion = `${baseVersion}-deploytest.${generateShortTimestamp()}+${latestTauriCommit}`
      } else {
        newVersion = `${baseVersion}-${versionArg.toLowerCase()}`
      }
    } else {
      if (!isValidVersion(versionArg)) {
        console.error('Error: Invalid version format')
        process.exit(1)
      }
      newVersion = normalizeVersion(versionArg)
    }

    console.log(`[INFO]: Updating versions to: ${newVersion}`)
    await updatePackageVersion(newVersion)
    await updateCargoVersion(newVersion)
    await updateTauriConfigVersion(newVersion)
    console.log('[SUCCESS]: All version updates completed successfully!')
  } catch (error) {
    console.error('[ERROR]: Failed to update versions:', error)
    process.exit(1)
  }
}

program
  .name('pnpm release-version')
  .description('Update project version numbers')
  .argument('<version>', 'version tag or full version')
  .action(main)
  .parse(process.argv)
