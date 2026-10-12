import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { compare } from './report.mjs'
const args = process.argv.slice(2).filter((v) => v !== '--')
if (args.length < 2)
  throw new Error(
    'Usage: pnpm perf:compare -- baseline/summary.json candidate/summary.json [noise-threshold-percent]',
  )
const threshold = args[2] === undefined ? null : Number(args[2])
if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0))
  throw new Error(
    'threshold must be a nonnegative percentage justified by baseline noise',
  )
function load(path) {
  if (statSync(path).isFile()) return JSON.parse(readFileSync(path))
  if (existsSync(join(path, 'summary.json')))
    return load(join(path, 'summary.json'))
  const reports = readdirSync(path)
    .sort()
    .map((name) => load(join(path, name)))
  const first = reports[0]
  if (
    !first ||
    reports.some(
      (r) =>
        r.build?.binarySha256 !== first.build?.binarySha256 ||
        ['invalid', 'incomparable'].includes(compare(first, r).verdict),
    )
  )
    throw new Error('group contains mixed builds, contracts, or invalid runs')
  return { ...first, runs: reports.flatMap((r) => r.runs) }
}
let result
try {
  result = compare(...args.slice(0, 2).map(load), threshold)
} catch (error) {
  result = { verdict: 'invalid', reason: String(error) }
}
console.log(JSON.stringify(result, null, 2))
if (['invalid', 'incomparable'].includes(result.verdict)) process.exitCode = 2
