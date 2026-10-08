import fs from 'node:fs'
import path from 'node:path'

/**
 * Architecture grep gates for the frontend contract flow. Select gates via
 * argv:
 *
 *   node scripts/check-architecture.mjs listen emit invoke
 *
 * - listen/emit: the Tauri event API may only be used under src/services/bus/**
 *   (the event bus). Detected as a bare `listen(`/`emit(` call (member calls
 *   like `this.emit(` are unrelated class methods) or as importing the name
 *   from '@tauri-apps/api/event'.
 * - invoke: `invoke(` calls may exist only under src/services/**.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')

const tauriEventImport = (name) =>
  new RegExp(
    `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'@tauri-apps/api/event'`,
  )

const GATES = {
  listen: {
    patterns: [/(?<![.\w])listen\(/, tauriEventImport('listen')],
    allowed: (file) => file.startsWith('src/services/bus/'),
    description: 'Tauri listen outside the event bus (src/services/bus)',
  },
  emit: {
    patterns: [/(?<![.\w])emit\(/, tauriEventImport('emit')],
    allowed: (file) => file.startsWith('src/services/bus/'),
    description: 'Tauri emit outside the event bus (src/services/bus)',
  },
  invoke: {
    patterns: [/\binvoke\(/],
    allowed: (file) => file.startsWith('src/services/'),
    description: 'invoke( outside the services layer (src/services)',
  },
}

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry.name) ? [full] : []
  })
}

const selected = process.argv.slice(2)
if (selected.length === 0) {
  console.error('usage: check-architecture.mjs <gate>... (listen|emit|invoke)')
  process.exit(2)
}

let violations = 0
for (const gate of selected) {
  const rule = GATES[gate]
  if (!rule) {
    console.error(`unknown gate: ${gate}`)
    process.exit(2)
  }
  for (const file of walk(SRC)) {
    const relative = path.relative(ROOT, file).replaceAll('\\', '/')
    if (rule.allowed(relative)) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (rule.patterns.some((pattern) => pattern.test(line))) {
        violations += 1
        console.error(
          `[arch] ${rule.description}: ${relative}:${index + 1}: ${line.trim()}`,
        )
      }
    })
  }
}

if (violations > 0) {
  console.error(`[arch] ${violations} violation(s) found`)
  process.exit(1)
}
console.log('[arch] no violations')
