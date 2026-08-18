import { exec } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'

const execPromise = promisify(exec)

async function getLatestCommitHash() {
  try {
    const { stdout } = await execPromise('git rev-parse HEAD')
    const commitHash = stdout.trim()
    const formathash = commitHash.substring(0, 7)
    console.log(`Found the latest commit hash code: ${commitHash}`)
    return formathash
  } catch (error) {
    console.error('pnpm run fix-alpha-version ERROR', error)
  }
}

async function updatePackageVersion(newVersion) {
  const _dirname = process.cwd()
  const packageJsonPath = path.join(_dirname, 'package.json')
  try {
    const data = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(data)
    let result = packageJson.version.replace('alpha', newVersion)
    if (!packageJson.version.includes(`alpha-`)) {
      result = packageJson.version.replace('alpha', `alpha-${newVersion}`)
    } else {
      result = packageJson.version.replace(/alpha-[^-]*/, `alpha-${newVersion}`)
    }
    console.log('[INFO]: Current version is: ', result)
    packageJson.version = result
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      'utf8',
    )
    console.log(`[INFO]: Alpha version update to: ${newVersion}`)
  } catch (error) {
    console.error('pnpm run fix-alpha-version ERROR', error)
  }
}

const newVersion = await getLatestCommitHash()
updatePackageVersion(newVersion).catch(console.error)
