/**
 * Override updater endpoints in tauri.conf.json for a specific channel.
 *
 * Usage:
 *   node scripts/override-updater-endpoints.mjs <channel>
 *
 * Example:
 *   node scripts/override-updater-endpoints.mjs autobuild
 *   # Changes: .../releases/download/updater/update.json
 *   #      → : .../releases/download/updater-autobuild/update.json
 */
import fs from 'fs'
import path from 'path'

const channel = process.argv[2]
if (!channel) {
  console.error('Usage: node scripts/override-updater-endpoints.mjs <channel>')
  process.exit(1)
}

const configPath = path.join(process.cwd(), 'src-tauri', 'tauri.conf.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

config.plugins.updater.endpoints = config.plugins.updater.endpoints.map(
  (endpoint) =>
    endpoint.replace('/download/updater/', `/download/updater-${channel}/`),
)

fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

console.log(`[INFO]: Updater endpoints switched to "${channel}" channel:`)
config.plugins.updater.endpoints.forEach((e) => console.log(`  ${e}`))
