import { fetch } from '@tauri-apps/plugin-http'

import { useQuery } from '@/services/query-client'

const PROBE_COUNT = 10
const PROBE_TIMEOUT_MS = 3_000

interface DnsLeakResult {
  exitCountry: string
  servers: { ip: string; country: string; org: string }[]
}

const withTimeout = async <T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

// bash.ws records which resolvers looked up <n>.<id>.bash.ws, then reports them by id.
async function probeDnsLeak(): Promise<DnsLeakResult> {
  const id = await withTimeout(10_000, async (signal) =>
    (
      await (
        await fetch('https://bash.ws/id', { connectTimeout: 8_000, signal })
      ).text()
    ).trim(),
  )
  if (!/^[a-z0-9]{6,64}$/i.test(id))
    throw new Error('DNS leak test unavailable')

  // Resolve through the WebView so the lookups take the same path as pages do.
  await Promise.allSettled(
    Array.from({ length: PROBE_COUNT }, (_, i) =>
      withTimeout(PROBE_TIMEOUT_MS, (signal) =>
        window.fetch(`https://${i + 1}.${id}.bash.ws/`, {
          mode: 'no-cors',
          cache: 'no-store',
          signal,
        }),
      ),
    ),
  )

  const rows: unknown = await withTimeout(10_000, async (signal) =>
    (
      await fetch(`https://bash.ws/dnsleak/test/${id}?json`, {
        connectTimeout: 8_000,
        signal,
      })
    ).json(),
  )
  if (!Array.isArray(rows)) throw new Error('DNS leak test unavailable')
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const entries = rows.map(
    (row) =>
      (row && typeof row === 'object' ? row : {}) as Record<string, unknown>,
  )
  const exit = entries.find((row) => text(row.type) === 'ip')
  return {
    exitCountry: text(exit?.country).toUpperCase(),
    servers: entries
      .filter((row) => text(row.type) === 'dns')
      .map((row) => ({
        ip: text(row.ip),
        country: text(row.country).toUpperCase(),
        org: text(row.org),
      })),
  }
}

export const useDnsLeak = () =>
  useQuery({
    queryKey: ['dnsLeak'],
    queryFn: probeDnsLeak,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
