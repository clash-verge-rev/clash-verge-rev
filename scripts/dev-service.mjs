import { execFileSync, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const developmentServiceDirectoryEnvironment =
  'CLASH_VERGE_DEV_SERVICE_DIR'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serviceRepository = resolve(
  repositoryRoot,
  '..',
  'clash-verge-service-ipc',
)
const serviceManifest = join(serviceRepository, 'Cargo.toml')
export const developmentServiceWatchPaths = [
  'src',
  'resources',
  'Cargo.toml',
  'Cargo.lock',
].map((name) => join(serviceRepository, name))

function executable(name, platform) {
  return join(
    serviceRepository,
    'target',
    'debug',
    platform === 'win32' ? `${name}.exe` : name,
  )
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const error = new Error(
        `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
      )
      error.exitCode = code
      reject(error)
    })
  })
}

export async function prepareDevelopmentService({
  platform = process.platform,
} = {}) {
  await access(serviceManifest)
  await run('cargo', [
    'build',
    '--manifest-path',
    serviceManifest,
    '--features',
    'standalone,client,development-channel',
    '--bins',
  ])

  const service = executable('clash-verge-service', platform)
  await access(service)
  return dirname(service)
}

export async function ensureDevelopmentService({
  platform = process.platform,
} = {}) {
  const serviceDirectory = await prepareDevelopmentService({ platform })
  const extension = platform === 'win32' ? '.exe' : ''
  const installer = join(
    serviceDirectory,
    `clash-verge-service-install${extension}`,
  )
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(
    /^host: (.+)$/m,
  )?.[1]
  if (!host) throw new Error('rustc did not report its host target')
  const args = ['--prepare-install', '--ensure']
  for (const name of ['verge-mihomo', 'verge-mihomo-alpha']) {
    args.push(
      '--core',
      `${name}${extension}`,
      join(
        repositoryRoot,
        'src-tauri',
        'sidecar',
        `${name}-${host}${extension}`,
      ),
    )
  }
  await run(installer, args)
  return serviceDirectory
}
