import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import legacy, { detectPolyfills } from '@vitejs/plugin-legacy'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const inventoryPath = 'scripts/modern-polyfills.json'
const staleMessage =
  'Modern polyfill inventory is stale; run pnpm polyfills:generate and commit scripts/modern-polyfills.json'

// Bind complete emitted module inputs as well as output: minification can hide APIs.
// Generation double-checks the exported detector against legacy's automatic build.
export function guardedLegacy(options) {
  const capturePath = process.env.MODERN_POLYFILLS_CAPTURE
  const inventory = capturePath
    ? null
    : JSON.parse(
        readFileSync(
          process.env.MODERN_POLYFILLS_INVENTORY || inventoryPath,
          'utf8',
        ),
      )
  const plugins = legacy({
    ...options,
    modernPolyfills: Boolean(capturePath),
    additionalModernPolyfills: [
      ...options.additionalModernPolyfills,
      ...(capturePath ? [] : inventory.imports),
    ],
  })
  const postProcess = plugins.find(
    (plugin) => plugin.name === 'vite:legacy-post-process',
  )
  if (!postProcess?.renderChunk) {
    throw new Error('plugin-legacy must provide its post-process render hook')
  }
  const original = postProcess.renderChunk
  const render = typeof original === 'function' ? original : original.handler
  const discovered = new Map()
  let chunkNames
  let context
  if (capturePath) {
    postProcess.renderChunk = async function (raw, chunk, output, meta) {
      chunkNames ??= Object.keys(meta.chunks)
      const imports = new Set()
      await detectPolyfills(
        raw,
        options.modernTargets,
        options.assumptions || {},
        imports,
      )
      discovered.set(chunk.fileName, imports)
      return render.call(this, raw, chunk, output, meta)
    }
  }
  return [
    ...plugins,
    {
      name: 'guard-modern-polyfills',
      enforce: 'post',
      apply: 'build',
      configResolved(config) {
        if (config.build.ssr || options.renderLegacyChunks !== false) {
          throw new Error(
            'Modern polyfill guard requires a modern-only app build',
          )
        }
        // Custom import paths must not bind the inventory to a checkout location.
        context = [
          {
            ...options,
            additionalModernPolyfills: options.additionalModernPolyfills.map(
              (file) =>
                path.relative(process.cwd(), file).split(path.sep).join('/'),
            ),
          },
          config.build.target,
          config.mode,
          ...[
            'package.json',
            'pnpm-lock.yaml',
            'vite.config.mts',
            'scripts/modern-polyfills.mjs',
            'scripts/generate-modern-polyfills.mjs',
          ].map((file) => digest(readFileSync(file))),
          ...[
            '.browserslistrc',
            'browserslist',
            'src/.browserslistrc',
            'src/browserslist',
          ].map((file) =>
            existsSync(file) ? digest(readFileSync(file)) : null,
          ),
          digest(
            readFileSync(new URL(import.meta.resolve('@vitejs/plugin-legacy'))),
          ),
        ]
      },
      generateBundle(_output, bundle) {
        const imports = capturePath
          ? [
              ...new Set(
                chunkNames.flatMap((name) => [...discovered.get(name)]),
              ),
            ]
          : inventory.imports
        const chunks = Object.values(bundle).filter(
          (file) => file.type === 'chunk',
        )
        const moduleIds = new Set(
          chunks.flatMap((chunk) => Object.keys(chunk.modules)),
        )
        const inputs = [...moduleIds].map((id) => {
          // Rolldown's runtime is generated, not a transformed input module.
          if (id === '\0rolldown/runtime.js') return null
          // Vite's HTML entry code embeds an absolute import to the main module.
          if (id.endsWith('.html')) return digest(readFileSync(id))
          const code = this.getModuleInfo(id)?.code
          if (code == null) this.error(`Missing emitted module input: ${id}`)
          return digest(code)
        })
        const fingerprint = digest(
          JSON.stringify([
            context,
            inputs.sort(),
            chunks.map((chunk) => digest(chunk.code)).sort(),
            imports,
          ]),
        )
        if (capturePath) {
          writeFileSync(capturePath, JSON.stringify({ fingerprint, imports }))
        } else if (!inventory.fingerprints.includes(fingerprint)) {
          this.error(staleMessage)
        }
      },
    },
  ]
}
