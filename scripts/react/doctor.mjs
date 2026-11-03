import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { globSync } from 'glob'

const { values, positionals } = parseArgs({
  options: { json: { type: 'boolean' } },
  allowPositionals: true,
})
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const files = positionals.length
  ? positionals
  : globSync('src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,html}', {
      cwd: root,
      nodir: true,
    }).sort()
if (files.length === 0) throw new Error('No source files found')
for (const file of files) {
  if (
    !/\.(?:[jt]sx?|[cm][jt]s|html)$/.test(file) ||
    !statSync(path.resolve(root, file)).isFile()
  )
    throw new Error(`Expected a source file: ${file}`)
}
const executable = fileURLToPath(
  new URL('../bin/react-doctor.js', import.meta.resolve('react-doctor')),
)
const result = spawnSync(
  process.execPath,
  [
    executable,
    ...files,
    '--json',
    '--no-telemetry',
    '--no-supply-chain',
    '--blocking',
    'none',
    '--yes',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  },
)
if (result.error) throw result.error
if (result.signal)
  throw new Error(`React Doctor terminated by ${result.signal}`)
const report = JSON.parse(result.stdout)
if (values.json) {
  process.stdout.write(result.stdout)
} else {
  for (const diagnostic of report.diagnostics) {
    console.log(
      `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.plugin}/${diagnostic.rule}\n  ${diagnostic.message}`,
    )
  }
  console.log(
    `${report.summary.totalDiagnosticCount} advisory diagnostics across ${report.projects.reduce((count, project) => count + project.analyzedFileCount, 0)} analyzed files`,
  )
}
// In 0.9.21, --blocking none also masks linter execution failures.
const incomplete = report.projects.filter((project) => !project.complete)
if (report.error) console.error(report.error.message)
for (const project of incomplete) {
  console.error(
    'Incomplete React Doctor scan:',
    project.directory,
    project.skippedCheckReasons,
  )
}
process.exitCode =
  result.status || (!report.ok || incomplete.length > 0 ? 1 : 0)
