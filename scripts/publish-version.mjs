// scripts/publish-version.mjs
import { execFileSync, spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const rootDir = process.cwd()
const scriptPath = path.join(rootDir, 'scripts', 'release-version.mjs')

if (!existsSync(scriptPath)) {
  console.error('release-version.mjs not found!')
  process.exit(1)
}

const versionArg = process.argv[2]
if (!versionArg) {
  console.error('Usage: pnpm publish-version <version>')
  process.exit(1)
}

// 1. 调用 release-version.mjs
const runRelease = () =>
  new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, versionArg], { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error('release-version failed'))
    })
  })

// 2. 判断是否需要打 tag
function isSemver(version) {
  return /^v?\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/i.test(
    version,
  )
}

function normalizeVersion(version) {
  return version.startsWith('v') ? version : `v${version}`
}

function readPackageVersion() {
  const pkg = JSON.parse(
    readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
  )
  return pkg.version
}

function validateTag(tag) {
  if (!isSemver(tag)) {
    console.error(`[ERROR]: Invalid git tag: ${tag}`)
    process.exit(1)
  }
}

async function run() {
  await runRelease()

  let tag = null
  if (versionArg === 'alpha') {
    // 读取 release-version.mjs 写入后的版本
    tag = normalizeVersion(readPackageVersion())
  } else if (isSemver(versionArg)) {
    // 1.2.3、v1.2.3、1.2.3-beta.1 或 1.2.3+build.1
    tag = normalizeVersion(versionArg)
  }

  if (tag) {
    validateTag(tag)

    // 打 tag 并推送
    try {
      execFileSync('git', ['tag', tag], { stdio: 'inherit' })
      execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' })
      console.log(`[INFO]: Git tag ${tag} created and pushed.`)
    } catch {
      console.error(`[ERROR]: Failed to create or push git tag: ${tag}`)
      process.exit(1)
    }
  } else {
    console.log('[INFO]: No git tag created for this version.')
  }
}

run()
