import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    version: { type: 'string' },
    file: { type: 'string', default: 'Changelog.md' },
  },
})

async function main() {
  let version = values.version
  if (!version) {
    const response = await fetch(
      'https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt',
      { signal: AbortSignal.timeout(30_000) },
    )
    if (!response.ok)
      throw new Error(`Failed to fetch Mihomo version: ${response.status}`)
    version = await response.text()
  }
  version = version.trim().replace(/^v?/, 'v')
  if (!/^v\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Invalid stable Mihomo version: ${version}`)

  const content = readFileSync(values.file, 'utf8')
  const title = /^## .+$/m.exec(content)
  if (!title) throw new Error('Could not find changelog title.')
  const start = title.index + title[0].length
  const end = content.indexOf('\n## ', start)
  const section = content.slice(start, end === -1 ? undefined : end)
  const line =
    /^(\s*-\s*(?:\*\*)?\s*Mihomo(?:\(Meta\))?\s*内核升级至\s*)v?\d+(?:\.\d+)+(?:[-+][^\s*]+)?((?:\*\*)?[\t ]*)$/m
  const nextSection = line.test(section)
    ? section.replace(line, `$1${version}$2`)
    : `\n\n- **Mihomo 内核升级至 ${version}**${section.replace(/^\n*/, '\n\n')}`
  const nextContent =
    content.slice(0, start) +
    nextSection +
    (end === -1 ? '' : content.slice(end))
  const changed = content !== nextContent

  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\nchanged=${changed}\n`,
    )
  if (!changed) {
    console.log(`Mihomo version in changelog is already ${version}`)
    return
  }

  const diff = spawnSync(
    'diff',
    [
      '-u',
      '--label',
      `a/${values.file}`,
      '--label',
      `b/${values.file}`,
      values.file,
      '-',
    ],
    { input: nextContent, encoding: 'utf8' },
  )
  if (diff.error) throw diff.error
  if (diff.status !== 1)
    throw new Error(diff.stderr || 'Could not preview changelog diff.')
  process.stdout.write(diff.stdout)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Mihomo ${version}\n\n\`\`\`diff\n${diff.stdout}\`\`\`\n`,
    )
  if (values.check) {
    process.exitCode = 1
    return
  }
  if (!values['dry-run']) writeFileSync(values.file, nextContent)
}

main().catch((error) => {
  console.error('sync-mihomo-version failed:', error.message)
  process.exitCode = 1
})
