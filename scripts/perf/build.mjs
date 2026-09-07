import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
const output = resolve(process.argv[2] ?? 'target/perf/build')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const command = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const source = () =>
  command('git', ['ls-files', '-co', '--exclude-standard'])
    .split('\n')
    .filter(existsSync)
    .filter(
      (path) =>
        !path.startsWith('scripts/perf/') ||
        /\.(rs|tsx|html|mts|json)$/.test(path),
    )
    .sort()
    .map((path) => `${path}\0${hash(readFileSync(path))}`)
    .join('\n')
mkdirSync(output, { recursive: true })
const before = hash(source())
const buildSettingsSha256 = hash(
  ['Cargo.toml', '.cargo/config.toml']
    .filter(existsSync)
    .map((path) => `${path}\0${hash(readFileSync(path))}`)
    .join('\n'),
)
execFileSync(
  'pnpm',
  [
    'exec',
    'vite',
    'build',
    '--mode',
    'perf',
    '--config',
    'scripts/perf/vite.mts',
  ],
  { stdio: 'inherit' },
)
const mode = 'release + perf-harness (build settings hash recorded)'
const buildCommand =
  'TAURI_CONFIG=<scripts/perf/tauri.json> cargo build -p clash-verge --release --features perf-harness --locked --target-dir target/perf/cargo'
execFileSync(
  'cargo',
  [
    'build',
    '-p',
    'clash-verge',
    '--release',
    '--features',
    'perf-harness',
    '--locked',
    '--target-dir',
    'target/perf/cargo',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_CONFIG: readFileSync('scripts/perf/tauri.json', 'utf8'),
    },
  },
)
if (before !== hash(source()))
  throw new Error('Source changed during build; refuse manifest')
const binary = `${output}/clash-verge`
copyFileSync('target/perf/cargo/release/clash-verge', binary)
const files = command('find', ['target/perf/dist', '-type', 'f'])
  .split('\n')
  .sort()
writeFileSync(
  `${binary}.json`,
  JSON.stringify(
    {
      head: command('git', ['rev-parse', 'HEAD']),
      dirty: command('git', ['status', '--porcelain']),
      sourceSha256: before,
      binarySha256: hash(readFileSync(binary)),
      frontendSha256: hash(
        files.map((path) => `${path}\0${hash(readFileSync(path))}`).join('\n'),
      ),
      mode,
      buildSettingsSha256,
      buildEnvironment: Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_PROFILE_|RUSTC_WRAPPER)/.test(
            key,
          ),
        ),
      ),
      buildCommand,
      binary,
      toolchain: `${command('rustc', ['--version'])}; node ${process.version}; pnpm ${command('pnpm', ['--version'])}`,
    },
    null,
    2,
  ),
)
console.log(`Measurement binary and manifest: ${binary}`)
