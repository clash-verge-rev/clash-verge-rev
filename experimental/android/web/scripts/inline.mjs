import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

let html = await readFile('dist/index.html', 'utf8')
const assets = await readdir('dist/assets')
const scripts = assets.filter((name) => name.endsWith('.js'))
const styles = assets.filter((name) => name.endsWith('.css'))
if (scripts.length !== 1 || styles.length > 1)
  throw new Error('Expected one offline script and at most one stylesheet')
const script = await readFile(`dist/assets/${scripts[0]}`, 'utf8')
const css = styles.length
  ? await readFile(`dist/assets/${styles[0]}`, 'utf8')
  : ''
if (!css && !script.includes('--canvas'))
  throw new Error('Mobile styles are missing from the bundle')
if (/<\/script/i.test(script) || /<\/style/i.test(css))
  throw new Error('Unexpected inline closing tag in bundle')
const hash = createHash('sha256').update(script).digest('base64')
const scriptTag = /<script\b[^>]*src="[^"]+"[^>]*><\/script>/g
const scriptTags = [...html.matchAll(scriptTag)]
if (scriptTags.length !== 1)
  throw new Error('Expected one script tag in the built page')
if (!/<\/body\s*>/i.test(html))
  throw new Error('Built page has no closing body tag')
html = html.replace(scriptTag, '')
html = html.replace(
  /<\/body\s*>/i,
  (closingTag) => `<script>${script}</script>\n  ${closingTag}`,
)
html = html.replace(
  /<link\b[^>]*rel="stylesheet"[^>]*>/,
  () => `<style>${css}</style>`,
)
html = html.replace("script-src 'self'", `script-src 'sha256-${hash}'`)
await writeFile('dist/index.html', html)
console.log(
  `Offline UI: ${Buffer.byteLength(html)} bytes; script integrity hash embedded`,
)
