import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

const forward = () => {
  const tauri = spawnSync(
    'pnpm',
    ['exec', 'tauri', 'build', ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
      },
      shell: process.platform === 'win32',
    },
  )
  process.exit(tauri.status ?? 1)
}

if (process.platform !== 'darwin') forward()

if (process.env.CLASH_VERGE_WIDGET === '0') {
  console.warn(
    'CLASH_VERGE_WIDGET=0: building without the desktop widget extension.',
  )
  process.env.APPLE_SIGNING_IDENTITY = '-'
  forward()
}

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) return ''
  return result.stdout
}

let identity = process.env.APPLE_SIGNING_IDENTITY
if (!identity) {
  const mac = JSON.parse(
    readFileSync(join(root, 'src-tauri/tauri.macos.conf.json'), 'utf8'),
  )
  identity = mac.bundle?.macOS?.signingIdentity || undefined
}
if (!identity) {
  const identities = [
    ...run('security', ['find-identity', '-v', '-p', 'codesigning']).matchAll(
      /\b([A-F0-9]{40}) "([^"]+)"/g,
    ),
  ]
  if (identities.length === 1) identity = identities[0][2]
}
if (!identity) {
  console.error(
    'macOS packaging needs the widget extension signed with the host: set APPLE_SIGNING_IDENTITY to a valid certificate, or export CLASH_VERGE_WIDGET=0 to build without the widget.',
  )
  process.exit(1)
}
process.env.APPLE_SIGNING_IDENTITY = identity
forward()
