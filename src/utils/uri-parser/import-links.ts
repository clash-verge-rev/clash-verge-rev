import * as yaml from 'js-yaml'

import parseUri from './index'

export interface ImportLinksResult {
  /** Proxies parsed successfully, with names made unique. */
  proxies: IProxyConfig[]
  /** Number of proxies that were imported. */
  imported: number
  /** Raw lines that could not be parsed into a proxy. */
  failed: string[]
  /** How many proxies had to be renamed to avoid a duplicate name. */
  renamed: number
}

/**
 * Share links can be pasted as-is (one link per line) or as a single
 * base64-encoded blob, which is how most subscription endpoints deliver them.
 * Detect the blob case and decode it, otherwise keep the text untouched.
 */
function decodeMaybeBase64(text: string): string {
  const trimmed = text.trim()
  // Already looks like plain links — nothing to decode.
  if (trimmed.includes('://')) return trimmed
  try {
    const decoded = atob(trimmed.replace(/\s+/g, ''))
    if (decoded.includes('://')) return decoded
  } catch {
    // Not valid base64; fall through and treat the input as plain text.
  }
  return trimmed
}

/**
 * Parse a block of pasted text into proxy configs.
 *
 * Every non-empty, non-comment line is run through {@link parseUri}. Lines that
 * fail to parse are collected in `failed` rather than silently dropped, and
 * duplicate names are disambiguated with a numeric suffix so the result is a
 * valid Clash config (mihomo rejects proxies that share a name).
 */
export function parseShareLinks(text: string): ImportLinksResult {
  const body = decodeMaybeBase64(text)
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))

  const proxies: IProxyConfig[] = []
  const failed: string[] = []
  const usedNames = new Set<string>()
  let renamed = 0

  for (const line of lines) {
    let proxy: IProxyConfig
    try {
      proxy = parseUri(line)
    } catch {
      failed.push(line)
      continue
    }

    const baseName = proxy.name || proxy.type || 'proxy'
    let name = baseName
    if (usedNames.has(name)) {
      let suffix = 2
      while (usedNames.has(`${baseName} ${suffix}`)) suffix += 1
      name = `${baseName} ${suffix}`
      renamed += 1
    }
    usedNames.add(name)
    proxy.name = name
    proxies.push(proxy)
  }

  return { proxies, imported: proxies.length, failed, renamed }
}

/**
 * Turn parsed proxies into a minimal but immediately usable local profile: a
 * select group holding every node (plus DIRECT) and a catch-all rule pointing
 * at it, so the imported nodes can actually be selected and route traffic.
 */
export function buildProxiesProfileYaml(
  proxies: IProxyConfig[],
  groupName = 'PROXY',
): string {
  const names = proxies.map((proxy) => proxy.name)
  const config = {
    proxies,
    'proxy-groups': [
      {
        name: groupName,
        type: 'select',
        proxies: [...names, 'DIRECT'],
      },
    ],
    rules: [`MATCH,${groupName}`],
  }
  // lineWidth: -1 keeps long values (base64 keys, encoded paths) on one line.
  // js-yaml already quotes strings only where a bare scalar would be ambiguous
  // (e.g. a password that looks like a number), so no forced quoting is needed.
  return yaml.dump(config, { lineWidth: -1 })
}
