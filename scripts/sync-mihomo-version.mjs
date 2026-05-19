import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const VERSION_URL =
  'https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt'
const DEFAULT_CHANGELOG = 'Changelog.md'

const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const DRY_RUN = args.includes('--dry-run')

const logError = (message, ...optionalParams) =>
  console.error(message, ...optionalParams)
const logInfo = (message, ...optionalParams) =>
  console.log(message, ...optionalParams)

function readArgValue(name) {
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1] ?? null
}

function normalizeVersion(version) {
  const normalized = version.trim()
  return normalized.startsWith('v') ? normalized : `v${normalized}`
}

async function fetchLatestVersion() {
  const explicitVersion = readArgValue('--version')
  if (explicitVersion) return normalizeVersion(explicitVersion)

  const response = await fetch(VERSION_URL, {
    method: 'GET',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${VERSION_URL}: ${response.status}`)
  }

  return normalizeVersion(await response.text())
}

function replaceExistingLine(content, version) {
  const mihomoLine =
    /^(\s*-\s*(?:\*\*)?\s*Mihomo\(Meta\)\s*内核升级至\s*)v?\d+(?:\.\d+)+(?:[-+][^\s*]+)?((?:\*\*)?\s*)$/m

  if (!mihomoLine.test(content)) return null

  return content.replace(mihomoLine, `$1${version}$2`)
}

function insertMihomoLine(content, version) {
  const title = /^## .+$/m
  const match = content.match(title)

  if (!match || match.index === undefined) {
    throw new Error('could not find changelog title')
  }

  const titleEnd = match.index + match[0].length
  const before = content.slice(0, titleEnd)
  const after = content.slice(titleEnd).replace(/^\n*/, '\n\n')

  return `${before}\n\n- **Mihomo(Meta) 内核升级至 ${version}**${after}`
}

async function main() {
  const cwd = process.cwd()
  const changelogArg = readArgValue('--file')
  const changelogPath = path.join(cwd, changelogArg || DEFAULT_CHANGELOG)

  if (!fs.existsSync(changelogPath)) {
    throw new Error(`could not find ${path.relative(cwd, changelogPath)}`)
  }

  const version = await fetchLatestVersion()
  const content = await fsp.readFile(changelogPath, 'utf-8')
  const nextContent =
    replaceExistingLine(content, version) ?? insertMihomoLine(content, version)

  if (nextContent === content) {
    logInfo(`Mihomo version in changelog is already ${version}`)
    return
  }

  if (CHECK) {
    logError(`Mihomo version in changelog is not ${version}`)
    process.exit(1)
  }

  if (DRY_RUN) {
    logInfo(`Would update Mihomo version in changelog to ${version}`)
    return
  }

  await fsp.writeFile(changelogPath, nextContent)
  logInfo(`Updated Mihomo version in changelog to ${version}`)
}

main().catch((error) => {
  logError('sync-mihomo-version failed:', error.message)
  process.exit(1)
})
