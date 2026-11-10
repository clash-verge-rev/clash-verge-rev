import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { build } from 'vite'

const [command, ...extra] = process.argv.slice(2)
if (!['--write', '--check'].includes(command) || extra.length) {
  throw new Error(
    'Usage: node scripts/generate-modern-polyfills.mjs --write|--check',
  )
}
const inventoryPath = 'scripts/modern-polyfills.json'
const staleMessage =
  'Modern polyfill inventory is stale; run pnpm polyfills:generate and commit scripts/modern-polyfills.json'

function outputHashes(result) {
  assert(
    !Array.isArray(result) && 'output' in result,
    'Expected one app output',
  )
  return result.output
    .map((file) => [
      file.fileName,
      createHash('sha256')
        .update(file.type === 'chunk' ? file.code : file.source)
        .digest('hex'),
    ])
    .sort(([a], [b]) => a.localeCompare(b))
}

const temporary = mkdtempSync(path.join(os.tmpdir(), 'modern-polyfills-'))
const capture = path.join(temporary, 'capture.json')
const candidate = path.join(temporary, 'inventory.json')
const snapshots = []
const fingerprints = []
let imports
try {
  process.env.MODERN_POLYFILLS_CAPTURE = capture
  // OS_PLATFORM changes emitted code; certify each production define without
  // launching a native app or normalizing away code the detector actually sees.
  for (const platform of ['darwin', 'linux', 'win32']) {
    const config = {
      logLevel: 'error',
      define: { OS_PLATFORM: JSON.stringify(platform) },
      build: { write: false },
    }
    const automatic = await build(config)
    const detected = JSON.parse(readFileSync(capture, 'utf8'))
    if (imports) assert.deepEqual(detected.imports, imports)
    imports = detected.imports
    fingerprints.push(detected.fingerprint)
    snapshots.push({ config, hashes: outputHashes(automatic) })
  }
  const content = `${JSON.stringify({ imports, fingerprints: [...new Set(fingerprints)].sort() }, null, 2)}\n`
  writeFileSync(candidate, content)
  delete process.env.MODERN_POLYFILLS_CAPTURE
  process.env.MODERN_POLYFILLS_INVENTORY = candidate
  for (const { config, hashes } of snapshots) {
    assert.deepEqual(
      outputHashes(await build(config)),
      hashes,
      'Explicit polyfills must be byte-identical to automatic discovery',
    )
  }
  if (command === '--check') {
    assert.equal(readFileSync(inventoryPath, 'utf8'), content, staleMessage)
  } else {
    writeFileSync(inventoryPath, content)
  }
  console.log(
    `Modern polyfills ${command === '--check' ? 'verified' : 'generated'}: ${imports.length} imports; all three OS outputs byte-identical to automatic discovery`,
  )
} finally {
  delete process.env.MODERN_POLYFILLS_CAPTURE
  delete process.env.MODERN_POLYFILLS_INVENTORY
  rmSync(temporary, { recursive: true })
}
