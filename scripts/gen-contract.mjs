import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
execFileSync(
  'cargo',
  ['run', '-p', 'clash-verge', '--bin', 'frontend-contract', '--locked', '-q'],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
)
execFileSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules/@biomejs/biome/bin/biome'),
    'format',
    '--write',
    'src/services/bindings.ts',
  ],
  { cwd: ROOT, stdio: 'inherit' },
)
