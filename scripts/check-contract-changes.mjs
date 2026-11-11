import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const { contract } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/contract-inputs.json'), 'utf8'),
)
const inputs = contract.map((pattern) => `:(glob)${pattern}`)
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--push') {
  console.error('usage: check-contract-changes.mjs --push <remote>')
  process.exit(2)
}
const hasChanges = (...range) =>
  git('diff', '--name-only', ...range, '--', ...inputs) !== ''
const assertCleanInputs = (...range) => {
  if (
    hasChanges(...range) ||
    git('ls-files', '--others', '--exclude-standard', '--', ...inputs)
  ) {
    throw new Error(
      'Contract inputs differ from the pushed commit. Commit those changes before pushing.',
    )
  }
}
let relevant = false
const head = git('rev-parse', 'HEAD')
for (const line of fs
  .readFileSync(0, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)) {
  const fields = line.trim().split(/\s+/)
  if (
    fields.length !== 4 ||
    ![fields[1], fields[3]].every((sha) => /^[a-f0-9]{40,64}$/.test(sha))
  ) {
    throw new Error('Invalid pre-push ref update')
  }
  const [, local, , remote] = fields
  if (/^0+$/.test(local) || local === remote) continue
  // A new remote branch has no upstream; use its fork point with the remote default branch.
  const base = /^0+$/.test(remote)
    ? git('merge-base', local, `refs/remotes/${args[1]}/HEAD`)
    : remote
  if (!hasChanges(base, local)) continue
  const commit = git('rev-parse', `${local}^{commit}`)
  if (commit !== head)
    throw new Error(
      'Check out the pushed commit before validating its changed IPC contract.',
    )
  assertCleanInputs('HEAD')
  relevant = true
}
if (relevant) {
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/gen-contract.mjs'), '--check'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  )
} else {
  console.log('[contract] inputs unchanged; skipping Rust generation')
}
