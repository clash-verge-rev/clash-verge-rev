import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BINDINGS = path.join(ROOT, 'src/services/bindings.ts')
const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  console.error('usage: gen-contract.mjs [--check]')
  process.exit(2)
}
const check = args[0] === '--check'
const temporary = check
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'verge-contract-'))
  : null
const output = temporary ? path.join(temporary, 'bindings.ts') : BINDINGS
try {
  execFileSync(
    'cargo',
    [
      'run',
      '-p',
      'clash-verge',
      '--bin',
      'frontend-contract',
      '--locked',
      '-q',
      ...(check ? ['--', output] : []),
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  const formatted = execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules/@biomejs/biome/bin/biome'),
      'format',
      '--stdin-file-path',
      BINDINGS,
    ],
    { cwd: ROOT, input: fs.readFileSync(output) },
  )
  if (check) {
    if (!formatted.equals(fs.readFileSync(BINDINGS))) {
      console.error(
        'IPC bindings are out of date. Run pnpm gen:contract and commit the generated file.',
      )
      process.exitCode = 1
    }
  } else {
    fs.writeFileSync(BINDINGS, formatted)
  }
} finally {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true })
}
