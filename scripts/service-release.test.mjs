import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { resolveServiceRelease } from './service-release.mjs'

test('service prebuild release follows the Cargo dependency version', async () => {
  const cargoManifest = await readFile(
    new URL('../src-tauri/Cargo.toml', import.meta.url),
    'utf8',
  )
  const dependencyVersion = cargoManifest
    .split(/\r?\n/)
    .find((line) => line.startsWith('clash_verge_service_ipc ='))
    ?.match(/\bversion\s*=\s*"([^"]+)"/)?.[1]

  assert.ok(dependencyVersion)
  const releaseVersion = `v${dependencyVersion}`
  assert.deepEqual(
    resolveServiceRelease(cargoManifest, 'x86_64-pc-windows-msvc', 'win32'),
    {
      version: releaseVersion,
      archiveFile: `clash-verge-service-ipc-${releaseVersion}-x86_64-pc-windows-msvc.zip`,
      downloadURL: `https://github.com/clash-verge-rev/clash-verge-service-ipc/releases/download/${releaseVersion}/clash-verge-service-ipc-${releaseVersion}-x86_64-pc-windows-msvc.zip`,
    },
  )
})

test('service prebuild rejects a dependency without an explicit version', () => {
  assert.throws(
    () =>
      resolveServiceRelease(
        'clash_verge_service_ipc = { path = "../service" }',
        'x86_64-pc-windows-msvc',
        'win32',
      ),
    /must declare an inline version/,
  )
})
