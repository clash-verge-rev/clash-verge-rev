import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'

const html = await readFile(
  new URL('../web/dist/index.html', import.meta.url),
  'utf8',
)
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
if (
  scripts.length !== 1 ||
  scripts[0][1].includes('src=') ||
  scripts[0][1].includes('module')
) {
  throw new Error('Offline host must have exactly one inline classic script')
}
new Script(scripts[0][2])
const hash = createHash('sha256').update(scripts[0][2]).digest('base64')
if (!html.includes(`script-src 'sha256-${hash}'`))
  throw new Error('CSP script integrity mismatch')
if (/<(?:script|link)[^>]*(?:src|href)="https?:/i.test(html))
  throw new Error('Remote executable resource detected')
if (!html.includes('--canvas'))
  throw new Error('Mobile visual styles are missing')
console.log('Offline script syntax, integrity and local resource checks passed')
