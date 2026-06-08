// Restore prebuilt native napi bindings for FreeBSD arm64.
//
// rolldown and lightningcss (pulled in by Vite 8) publish no freebsd-arm64
// native binding. rolldown's wasm fallback is unstable at this project's scale
// (random deadlocks / OOM), so we ship locally-compiled native .node files
// under freebsd-bindings/ and copy them into node_modules after each install.
//
// No-op on every platform except FreeBSD arm64.

import { existsSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

if (process.platform !== 'freebsd' || process.arch !== 'arm64') {
  process.exit(0)
}

const srcDir = join(root, 'freebsd-bindings')
const pnpmDir = join(root, 'node_modules', '.pnpm')

// Map each prebuilt binding to the pnpm package dir prefix + relative dest.
const targets = [
  {
    file: 'rolldown-binding.freebsd-arm64.node',
    pkgPrefix: 'rolldown@',
    inner: join('node_modules', 'rolldown', 'dist', 'shared'),
  },
  {
    file: 'lightningcss.freebsd-arm64.node',
    pkgPrefix: 'lightningcss@',
    inner: join('node_modules', 'lightningcss'),
  },
]

function findPkgDir(prefix) {
  if (!existsSync(pnpmDir)) return null
  const match = readdirSync(pnpmDir).find((d) => d.startsWith(prefix))
  return match ? join(pnpmDir, match) : null
}

let restored = 0
for (const t of targets) {
  const src = join(srcDir, t.file)
  if (!existsSync(src)) {
    console.warn(`[freebsd-bindings] missing source: ${src}`)
    continue
  }
  const pkgDir = findPkgDir(t.pkgPrefix)
  if (!pkgDir) {
    console.warn(`[freebsd-bindings] package not found: ${t.pkgPrefix}*`)
    continue
  }
  const dest = join(pkgDir, t.inner, t.file)
  copyFileSync(src, dest)
  console.info(`[freebsd-bindings] restored ${t.file}`)
  restored++
}

console.info(`[freebsd-bindings] done (${restored}/${targets.length} restored)`)
