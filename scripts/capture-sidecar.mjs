import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function buildCaptureSidecar(target) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const [architecture] = target.split('-')
  const goarch = {
    aarch64: 'arm64',
    x86_64: 'amd64',
    i686: '386',
    armv7: 'arm',
    riscv64gc: 'riscv64',
    loongarch64: 'loong64',
  }[architecture]
  const goos = target.includes('windows')
    ? 'windows'
    : target.includes('apple')
      ? 'darwin'
      : target.includes('linux')
        ? 'linux'
        : null
  if (!goarch || !goos) throw new Error(`Unsupported capture target: ${target}`)
  const output = path.join(
    root,
    'src-tauri/sidecar',
    `clash-capture-${target}${goos === 'windows' ? '.exe' : ''}`,
  )
  fs.mkdirSync(path.dirname(output), { recursive: true })
  execFileSync(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', output, '.'],
    {
      cwd: path.join(root, 'sidecars/clash-capture'),
      stdio: 'inherit',
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: goos,
        GOARCH: goarch,
        ...(architecture === 'armv7' ? { GOARM: '7' } : {}),
      },
    },
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const target = process.argv[2]
  if (!target)
    throw new Error(
      'Usage: node scripts/capture-sidecar.mjs <Rust target triple>',
    )
  buildCaptureSidecar(target)
}
