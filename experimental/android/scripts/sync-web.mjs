import { cp, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = join(root, 'web', 'dist')
await access(join(dist, 'index.html'))
const targets = [join(root, 'android', 'app', 'src', 'main', 'assets', 'web')]
for (const target of targets) await cp(dist, target, { recursive: true })
const hash = createHash('sha256')
  .update(await readFile(join(dist, 'index.html')))
  .digest('hex')
console.log(`Shared offline UI synchronized; SHA256 ${hash}`)
