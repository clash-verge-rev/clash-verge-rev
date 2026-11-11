import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const platforms = {
  'x86_64-pc-windows-msvc': 'x64',
  'aarch64-pc-windows-msvc': 'arm64',
}

export function createWixBuildArgs({ target, sourceDir }, version) {
  const platform = target ? platforms[target] : process.arch
  if (!['x64', 'arm64'].includes(platform)) {
    throw new Error(
      `Unsupported Windows packaging target: ${target ?? platform}`,
    )
  }

  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.exec(version)
  if (
    !match ||
    Number(match[1]) > 255 ||
    Number(match[2]) > 255 ||
    Number(match[3]) > 65535
  ) {
    throw new Error(
      `Version cannot be represented as an MSI ProductVersion: ${version}`,
    )
  }
  const msiVersion = match.slice(1, 4).map(Number).join('.')
  const releaseDirectory = sourceDir
    ? resolve(sourceDir)
    : join(repositoryRoot, 'target', ...(target ? [target] : []), 'release')

  return [
    'build',
    join(repositoryRoot, 'src-tauri/packages/windows/wix/ClashVerge.wixproj'),
    '-c',
    'Release',
    '--nologo',
    `-p:SourceDir=${releaseDirectory}`,
    `-p:InstallerPlatform=${platform}`,
    `-p:AppVersion=${msiVersion}`,
    `-p:AppDisplayVersion=${version}`,
  ]
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      'source-dir': { type: 'string' },
    },
  })
  const { version } = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  )
  const args = createWixBuildArgs(
    { target: values.target, sourceDir: values['source-dir'] },
    version,
  )
  const result = spawnSync('dotnet', args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
