import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { build, createServer, preview } from 'vite'

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    assert: { type: 'string', multiple: true },
  },
})
if (!values.base || !values.head)
  throw new Error('Usage: pnpm react:ab --base <ref> --head <ref>')
const assertions = new Set(values.assert ?? [])
for (const name of assertions) {
  if (!['dns', 'delay', 'tabs'].includes(name))
    throw new Error(`Unknown regression assertion: ${name}`)
}
const harness = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(harness, '../..')
const output = await mkdtemp('/tmp/cvr-react-ab-')
const dependencies = path.join(root, 'node_modules')
const frozenHarness = path.join(output, 'harness')
await cp(harness, frozenHarness, {
  recursive: true,
  filter: (file) => !path.basename(file).startsWith('tsconfig'),
})
const files = [
  'src/components/setting/mods/dns-viewer.tsx',
  'src/hooks/use-proxy-delay-state.ts',
  'src/components/home/proxy-tun-card.tsx',
]
const hash = (content) => createHash('sha256').update(content).digest('hex')
function git(...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  return result.stdout
}
const manifest = {
  assertions: [...assertions],
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    os: os.release(),
    lock: hash(await readFile(path.join(root, 'pnpm-lock.yaml'))),
  },
  harness: Object.fromEntries(
    await Promise.all(
      (await readdir(frozenHarness)).map(async (file) => [
        file,
        hash(await readFile(path.join(frozenHarness, file))),
      ]),
    ),
  ),
  installedLock: hash(
    await readFile(path.join(dependencies, '.pnpm/lock.yaml')),
  ),
  sources: {},
  runs: [],
}
let browser
try {
  // Playwright intentionally fails here if its explicitly installed browser is missing.
  browser = await chromium.launch({ headless: true })
  manifest.environment.browser = browser.version()
  for (const [variant, ref] of Object.entries({
    base: values.base,
    head: values.head,
  })) {
    const tree = git('rev-parse', '--verify', `${ref}^{tree}`).toString().trim()
    const source = path.join(output, variant)
    await mkdir(source)
    const archive = git('archive', tree, 'src')
    const extracted = spawnSync('tar', ['-x', '-C', source], { input: archive })
    if (extracted.status !== 0) throw new Error(extracted.stderr.toString())
    await cp(frozenHarness, path.join(source, 'fixture'), { recursive: true })
    await symlink(dependencies, path.join(source, 'node_modules'), 'dir')
    manifest.sources[variant] = {
      ref,
      tree,
      files: Object.fromEntries(
        await Promise.all(
          files.map(async (file) => [
            file,
            hash(await readFile(path.join(source, file))),
          ]),
        ),
      ),
    }
  }
  for (const mode of ['development', 'strict', 'production']) {
    const servers = {}
    try {
      for (const variant of ['base', 'head']) {
        const source = path.join(output, variant)
        const fixture = path.join(source, 'fixture')
        const boundary = path.join(fixture, 'boundaries.tsx')
        const aliases = [
          '@/hooks/use-clash',
          '@/hooks/use-verge',
          '@/hooks/use-profiles',
          '@/hooks/use-system-state',
          '@/hooks/use-system-proxy-state',
          '@/services/states',
          '@/services/cmds',
          '@/services/mutate',
          '@/services/notice-service',
          '@/components/base',
          '@/components/shared/proxy-control-switches',
          'react-i18next',
        ].map((find) => ({ find, replacement: boundary }))
        const config = {
          configFile: false,
          root: fixture,
          cacheDir: path.join(output, 'cache', variant, mode),
          plugins: [react()],
          resolve: {
            alias: [
              ...aliases,
              {
                find: '@/services/delay',
                replacement: path.join(fixture, 'delay.ts'),
              },
              {
                find: /^@mui\/material$/,
                replacement: path.join(fixture, 'material.tsx'),
              },
              {
                find: 'fixture-material',
                replacement: path.join(dependencies, '@mui/material/index.mjs'),
              },
              { find: 'js-yaml', replacement: path.join(fixture, 'yaml.ts') },
              {
                find: 'fixture-yaml',
                replacement: path.join(
                  dependencies,
                  'js-yaml/dist/js-yaml.mjs',
                ),
              },
              { find: '@', replacement: path.join(source, 'src') },
              {
                find: /^react(?=\/|$)/,
                replacement: path.join(dependencies, 'react'),
              },
              {
                find: /^react-dom(?=\/|$)/,
                replacement: path.join(dependencies, 'react-dom'),
              },
            ],
            dedupe: ['react', 'react-dom'],
          },
          define: { OS_PLATFORM: JSON.stringify(process.platform) },
          server: {
            host: '127.0.0.1',
            port: 0,
            hmr: false,
            fs: {
              allow: [
                output,
                await realpath(output),
                await realpath(dependencies),
              ],
            },
          },
          build: {
            outDir: path.join(output, 'dist', variant, mode),
            emptyOutDir: true,
          },
          preview: { host: '127.0.0.1', port: 0 },
        }
        if (mode === 'production') {
          await build(config)
          servers[variant] = await preview(config)
        } else {
          servers[variant] = await createServer(config)
          await servers[variant].listen()
        }
      }
      for (const [pair, order] of [
        ['base', 'head'],
        ['head', 'base'],
        ['base', 'head'],
      ].entries()) {
        for (const variant of order) {
          const label = `${mode}-${pair + 1}-${variant}`
          const context = await browser.newContext()
          const errors = []
          const address = servers[variant].httpServer.address()
          const origin = `http://127.0.0.1:${address.port}`
          await context.route('**/*', (route) => {
            if (new URL(route.request().url()).origin === origin)
              return route.continue()
            errors.push(`Unexpected network: ${route.request().url()}`)
            return route.abort()
          })
          const page = await context.newPage()
          page.on('pageerror', (error) => errors.push(String(error)))
          const result = { label, variant, mode, pair: pair + 1, errors }
          try {
            await page.goto(`${origin}/${mode === 'strict' ? '?strict' : ''}`)
            await page.waitForSelector('#delay', { timeout: 60000 })
            await page.waitForFunction(
              () => window.__REACT_AB__.read().listeners.length === 1,
            )
            result.tabs = await tabs(page)
            if (variant === 'head' && assertions.has('tabs')) {
              assert.equal(
                result.tabs.unrelated,
                0,
                'Unrelated parent updates must not rerender the memoized tabs',
              )
            }
            result.dns = await dns(page)
            if (variant === 'head' && assertions.has('dns')) {
              for (const edit of result.dns.edits) {
                assert.equal(
                  edit.serialized.at(-1),
                  edit.value,
                  'Latest DNS serialization must match the edited field',
                )
              }
            }
            result.delay = await delay(page)
            if (variant === 'head' && assertions.has('delay')) {
              for (const [index, observation] of result.delay.entries()) {
                assert.equal(
                  observation.sameReference,
                  index === 1,
                  'Preserve the reference only when all three delay fields match',
                )
              }
              assert.equal(
                result.delay[1].childRenders,
                result.delay[0].childRenders,
                'Equal delay state must not rerender the memoized consumer',
              )
            }
            result.profile = await page.evaluate(() => {
              const before = window.__CVR_REACT_PROFILER__.read()
              window.__CVR_REACT_PROFILER__.clear()
              return { before, after: window.__CVR_REACT_PROFILER__.read() }
            })
            assert.equal(result.profile.after.length, 0)
            result.collector = await page.evaluate(() =>
              window.__REACT_AB__.checkCollector(),
            )
            assert.deepEqual(result.collector, {
              length: 1000,
              first: '5',
              last: '1004',
              copied: true,
              cleared: true,
            })
            if (mode !== 'production')
              assert(
                result.profile.before.length > 0 &&
                  result.profile.before.length <= 1000,
              )
            assert.deepEqual(errors, [])
            assert.deepEqual(
              await page.evaluate(() =>
                window.__REACT_AB__.fixture.notices.filter(
                  (notice) => notice.error,
                ),
              ),
              [],
            )
            result.ok = true
          } catch (error) {
            result.snapshot = await page
              .evaluate(() => window.__REACT_AB__?.read())
              .catch(() => null)
            result.ok = false
            result.error = String(error)
            throw error
          } finally {
            manifest.runs.push(result)
            await writeFile(
              path.join(output, `${label}.json`),
              JSON.stringify(result, null, 2),
            )
            await context.close()
            console.log(`${label}: ${result.ok ? 'pass' : 'FAIL'}`)
          }
        }
      }
    } finally {
      for (const server of Object.values(servers)) {
        if (server.close) await server.close()
        else
          await new Promise((resolve, reject) =>
            server.httpServer.close((error) =>
              error ? reject(error) : resolve(),
            ),
          )
      }
    }
  }
} finally {
  await browser?.close()
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(manifest, null, 2),
  )
  console.log(`Evidence: ${output}`)
}

async function settle(page) {
  await page.waitForTimeout(100)
}
async function tabs(page) {
  const buttons = page.locator('#tabs .MuiPaper-root')
  const readTabs = () =>
    page.evaluate(() =>
      Object.fromEntries(
        window.__REACT_AB__.fixture.tabRenders.map((tab) => [
          tab.label.split('.').at(-1),
          tab,
        ]),
      ),
    )

  assert.equal(await buttons.count(), 2)
  assert.equal((await readTabs()).systemProxy.active, true)
  assert.equal((await readTabs()).tunMode.active, false)
  const before = await page.evaluate(
    () => window.__REACT_AB__.fixture.tabRenders.length,
  )
  for (let index = 0; index < 5; index++) {
    await page.evaluate(() => window.__REACT_AB__.update())
    await settle(page)
  }
  const unrelated =
    (await page.evaluate(() => window.__REACT_AB__.fixture.tabRenders.length)) -
    before
  await buttons.nth(1).click()
  await settle(page)
  assert.equal((await readTabs()).systemProxy.active, false)
  assert.equal((await readTabs()).tunMode.active, true)
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('clash-verge-proxy-active-tab'),
    ),
    'tun',
  )
  assert(
    (await page.locator('#fixture-controls').textContent()).endsWith(
      'toggles.tunMode',
    ),
  )
  await page.evaluate(() => window.__REACT_AB__.update({ mounted: false }))
  await settle(page)
  assert(
    (await page.locator('#fixture-controls').textContent()).endsWith(
      'toggles.tunMode',
    ),
  )
  await page.evaluate(() => window.__REACT_AB__.update({ mounted: true }))
  await settle(page)
  assert.equal((await readTabs()).tunMode.active, true)
  assert.equal((await readTabs()).systemProxy.active, false)
  await buttons.nth(0).click()
  await settle(page)
  assert.equal((await readTabs()).systemProxy.active, true)
  assert.equal((await readTabs()).tunMode.active, false)
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('clash-verge-proxy-active-tab'),
    ),
    'system',
  )
  await page.evaluate(() => {
    window.__REACT_AB__.fixture.indicator = true
    window.__REACT_AB__.fixture.verge.enable_tun_mode = true
    window.__REACT_AB__.update()
  })
  await settle(page)
  assert(Object.values(await readTabs()).every((tab) => tab.indicator))
  await page.evaluate(() => {
    window.__REACT_AB__.fixture.language = 'zh'
    window.__REACT_AB__.update()
  })
  await settle(page)
  const updated = Object.values(await readTabs())
  assert(updated.every((tab) => tab.label.startsWith('zh:')))
  assert(
    (await page.locator('#tabs').textContent()).includes(
      'zh:home.components.proxyTun.status.systemProxyEnabled',
    ),
  )
  const beforeColor = await buttons
    .nth(0)
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  await page.evaluate(() => {
    window.__REACT_AB__.fixture.theme = 'dark'
    window.__REACT_AB__.update()
  })
  await settle(page)
  const color = await buttons
    .nth(0)
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  assert.notEqual(color, beforeColor)
  return { unrelated, updated, beforeColor, color }
}
async function dns(page) {
  await page.evaluate(() => window.__REACT_AB__.open())
  const listen = page.locator('#dns input[placeholder=":53"]')
  await page.waitForFunction(
    () =>
      document.querySelector('#dns input[placeholder=":53"]')?.value ===
      ':5353',
  )
  const edits = []
  for (const value of [':54', ':55', ':56']) {
    await page.evaluate(() => {
      window.__REACT_AB__.fixture.serialized.length = 0
    })
    await listen.fill(value)
    await settle(page)
    assert.equal(await listen.inputValue(), value)
    edits.push({
      value,
      serialized: await page.evaluate(() =>
        window.__REACT_AB__.fixture.serialized.map(
          (config) => config.dns.listen,
        ),
      ),
    })
  }
  await page.evaluate(() => {
    window.__REACT_AB__.fixture.serialized.length = 0
  })
  await listen.fill(':')
  await listen.pressSequentially('567', { delay: 0 })
  await settle(page)
  assert.equal(await listen.inputValue(), ':567')
  edits.push({
    value: ':567',
    rapid: true,
    serialized: await page.evaluate(() =>
      window.__REACT_AB__.fixture.serialized.map((config) => config.dns.listen),
    ),
  })
  await page.locator('#save-dns').click()
  await page.waitForFunction(
    () => window.__REACT_AB__.fixture.saved.length === 1,
  )
  assert.equal(
    await page.evaluate(() => window.__REACT_AB__.fixture.saved[0].dns.listen),
    ':567',
  )
  await page.evaluate(() => window.__REACT_AB__.open())
  await page.waitForSelector('#dns')
  await page
    .getByRole('button', { name: /shared.actions.resetToDefault$/ })
    .click()
  await settle(page)
  assert.equal(await listen.inputValue(), ':53')
  await page
    .getByRole('button', { name: /shared.editorModes.advanced$/ })
    .click()
  await settle(page)
  const editor = page.locator('#fixture-monaco')
  assert.match(await editor.inputValue(), /listen: ["']?:53/)
  await editor.fill(
    'dns:\n  enable: true\n  listen: ":8053"\nhosts:\n  example.test: 127.0.0.1\n',
  )
  await page
    .getByRole('button', { name: /shared.editorModes.visualization$/ })
    .click()
  await settle(page)
  assert.equal(await listen.inputValue(), ':8053')
  await page
    .getByRole('button', { name: /shared.editorModes.advanced$/ })
    .click()
  await settle(page)
  await page.locator('#save-dns').click()
  await page.waitForFunction(
    () => window.__REACT_AB__.fixture.saved.length === 2,
  )
  const saved = await page.evaluate(() => window.__REACT_AB__.fixture.saved)
  assert.equal(saved[1].dns.listen, ':8053')
  assert.equal(saved[1].hosts['example.test'], '127.0.0.1')
  return { edits, saved }
}
async function delay(page) {
  const updates = [
    { delay: 10, elapsed: 12, updatedAt: 100 },
    { delay: 10, elapsed: 12, updatedAt: 100 },
    { delay: 11, elapsed: 12, updatedAt: 100 },
    { delay: 11, elapsed: 13, updatedAt: 100 },
    { delay: 11, elapsed: 13, updatedAt: 101 },
    { delay: 11, updatedAt: 101 },
    { delay: -1, updatedAt: 102 },
    { delay: 0, updatedAt: 103 },
    { delay: 1000000, elapsed: 20, updatedAt: 104 },
  ]
  const observations = []
  for (const update of updates) {
    await page.evaluate((value) => {
      window.__REACT_AB__.remember()
      window.__REACT_AB__.delay.emit('Node 1', 'Group 1', value)
    }, update)
    await settle(page)
    const result = await page.evaluate(() => window.__REACT_AB__.read())
    assert.deepEqual(result.delay, update)
    observations.push({
      update,
      sameReference: result.sameReference,
      childRenders: result.childRenders,
    })
  }
  await page.evaluate(() => window.__REACT_AB__.request())
  await settle(page)
  assert.equal(
    await page.evaluate(() => window.__REACT_AB__.read().delay.delay),
    -2,
  )
  await page.evaluate(() =>
    window.__REACT_AB__.delay.finish({ delay: 0, updatedAt: 200 }),
  )
  await settle(page)
  assert.equal(
    await page.evaluate(() => window.__REACT_AB__.read().delay.delay),
    0,
  )
  await page.evaluate(() => window.__REACT_AB__.request())
  await settle(page)
  assert.equal(
    await page.evaluate(() => window.__REACT_AB__.read().delay.delay),
    -2,
  )
  await page.evaluate(() =>
    window.__REACT_AB__.delay.finish({
      delay: 1000000,
      elapsed: 20,
      updatedAt: 201,
    }),
  )
  await settle(page)
  assert.deepEqual(
    await page.evaluate(() => window.__REACT_AB__.read().delay),
    { delay: 1000000, elapsed: 20, updatedAt: 201 },
  )
  await page.evaluate(() => window.__REACT_AB__.update({ name: 'Node 2' }))
  await settle(page)
  let state = await page.evaluate(() => window.__REACT_AB__.read())
  assert.deepEqual(state.listeners, ['Group 1:Node 2'])
  assert.deepEqual(state.delay, { delay: -1, updatedAt: 0 })
  await page.evaluate(() => window.__REACT_AB__.update({ group: 'Group 2' }))
  await settle(page)
  state = await page.evaluate(() => window.__REACT_AB__.read())
  assert.deepEqual(state.listeners, ['Group 2:Node 2'])
  for (const name of ['DIRECT', 'Unknown']) {
    await page.evaluate((name) => window.__REACT_AB__.update({ name }), name)
    await settle(page)
    const preset = await page.evaluate(() => window.__REACT_AB__.read())
    assert.deepEqual(preset.listeners, [])
    assert.deepEqual(preset.delay, { delay: -1, updatedAt: 0 })
  }
  await page.evaluate(() => window.__REACT_AB__.update({ name: 'Node 2' }))
  await settle(page)
  assert.deepEqual(
    await page.evaluate(() => window.__REACT_AB__.read().listeners),
    ['Group 2:Node 2'],
  )
  await page.evaluate(() => window.__REACT_AB__.update({ mounted: false }))
  await settle(page)
  assert.deepEqual(
    await page.evaluate(() => window.__REACT_AB__.read().listeners),
    [],
  )
  return observations
}
