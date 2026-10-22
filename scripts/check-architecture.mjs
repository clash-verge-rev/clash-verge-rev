import path from 'node:path'

import { ESLint } from 'eslint'

const ROOT = path.resolve(import.meta.dirname, '..')
const gates = process.argv.slice(2)
if (
  !gates.length ||
  gates.some((gate) => !['listen', 'emit', 'invoke'].includes(gate))
) {
  console.error('usage: check-architecture.mjs <gate>... (listen|emit|invoke)')
  process.exit(2)
}

// All IPC boundaries use the lint configuration, including when callers request a legacy gate.
const eslint = new ESLint({ cwd: ROOT, allowInlineConfig: false })
const results = await eslint.lintFiles(['src'])
const boundaryRules = new Set([
  'no-restricted-imports',
  'no-restricted-syntax',
  '@typescript-eslint/no-floating-promises',
])
const violations = results.flatMap((result) =>
  result.messages
    .filter((message) => message.fatal || boundaryRules.has(message.ruleId))
    .map((message) => ({ file: result.filePath, ...message })),
)
for (const violation of violations) {
  console.error(
    `[arch] ${path.relative(ROOT, violation.file)}:${violation.line}: ${violation.message}`,
  )
}
if (violations.length) process.exitCode = 1
else console.log('[arch] no violations')
