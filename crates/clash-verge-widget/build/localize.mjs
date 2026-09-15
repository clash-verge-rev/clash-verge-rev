import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const resources = process.argv[2]
if (!resources) throw new Error('Pass the extension resources directory.')
const catalogs = join(root, 'crates/clash-verge-i18n/locales')
for (const file of readdirSync(catalogs)
  .filter((file) => file.endsWith('.yml'))
  .sort()) {
  const locale = file.slice(0, -4)
  const catalog = load(readFileSync(join(catalogs, file), 'utf8'))
  const language =
    { jp: 'ja', zh: 'zh-Hans', zhtw: 'zh-Hant' }[locale] || locale
  const strings = {
    'tray.rule': catalog.tray.rule,
    'tray.global': catalog.tray.global,
    'tray.direct': catalog.tray.direct,
    'tray.systemProxy': catalog.tray.systemProxy,
    'tray.tooltip.tun': catalog.tray.tooltip.tun,
  }
  for (const [key, value] of Object.entries(catalog.widget))
    strings[`widget.${key}`] = value
  const directory = join(resources, `${language}.lproj`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'Localizable.strings'),
    Object.entries(strings)
      .map(
        ([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`,
      )
      .join('\n'),
  )
}
