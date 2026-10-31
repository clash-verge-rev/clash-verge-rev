import type { SpeedTestResult } from '@/services/bindings'
import { cmdTestSpeed } from '@/services/cmds'
import { debugLog } from '@/utils/debug'

/**
 * Default download endpoint used for the throughput measurement.
 *
 * Only Cloudflare exposes a raw byte-stream endpoint that works with a plain
 * `GET` (the other common speed-test sites — speedtest.net, fast.com, Google
 * Fiber — are HTML/JS pages and cannot be measured by a direct download).
 * Users can override this in Verge settings via `speed_test_url`.
 *
 * 50 MiB, not 100 MiB: the endpoint rejects requests above a certain size with
 * HTTP 403, which used to make every measurement come back as 0 B/s.
 */
export const DEFAULT_SPEED_TEST_URL =
  'https://speed.cloudflare.com/__down?bytes=52428800'

/**
 * Selectable download sources.
 *
 * A source has to be a raw byte stream served by a plain `GET`. The usual
 * speed-test websites (speedtest.net, fast.com, fiber.google.com) only ship
 * HTML/JS pages whose real transfer happens against an API that needs a
 * session handshake, so they cannot be used as a download target here.
 */
export const SPEED_TEST_SOURCES: { label: string; url: string }[] = [
  { label: 'Cloudflare (50 MB)', url: DEFAULT_SPEED_TEST_URL },
  {
    label: 'CacheFly (100 MB)',
    url: 'https://cachefly.cachefly.net/100mb.test',
  },
  { label: 'OVH (100 MB)', url: 'https://proof.ovh.net/files/100Mb.dat' },
  {
    label: 'TUNA Mirror (100 MB)',
    url: 'https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/22.04/ubuntu-22.04.5-live-server-amd64.iso',
  },
]

export interface SpeedUpdate {
  /** bytes/sec; -2 = testing, -1 = untested, 0 = measured-but-zero/error, >0 = measured */
  speed: number
  /** best sampled throughput after warm-up, bytes/sec */
  peak: number
  downloaded: number
  elapsed: number
  updatedAt: number
  /** Failure reason when the last measurement did not produce any bytes. */
  error?: string
}

const hashKey = (name: string, group: string) => `${group ?? ''}::${name}`
const CACHE_TTL = 30 * 60 * 1000

/**
 * Measurement window for a bandwidth test. Warm-up (TCP slow start, TLS
 * handshake) eats the first ~2s, so a longer window reports a truer peak.
 */
export const SPEED_TEST_WINDOW_MS = 8000
const DEFAULT_TIMEOUT_MS = SPEED_TEST_WINDOW_MS

class SpeedManager {
  private cache = new Map<string, SpeedUpdate>()
  private listeners = new Map<string, Set<(update: SpeedUpdate) => void>>()

  setListener(
    name: string,
    group: string,
    listener: (update: SpeedUpdate) => void,
  ): () => void {
    const key = hashKey(name, group)
    const set = this.listeners.get(key) ?? new Set()
    set.add(listener)
    this.listeners.set(key, set)
    return () => {
      const current = this.listeners.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.listeners.delete(key)
    }
  }

  removeListener(name: string, group: string) {
    this.setListener(name, group, () => {})
  }

  private notify(key: string, update: SpeedUpdate) {
    this.listeners.get(key)?.forEach((listener) => {
      try {
        listener(update)
      } catch (error) {
        console.error('[SpeedManager] 通知监听器失败:', key, error)
      }
    })
  }

  setSpeed(
    name: string,
    group: string,
    update: Omit<SpeedUpdate, 'updatedAt'>,
  ): SpeedUpdate {
    const key = hashKey(name, group)
    const full: SpeedUpdate = { ...update, updatedAt: Date.now() }
    this.cache.set(key, full)
    debugLog(
      `[SpeedManager] 设置网速，代理: ${name}, 组: ${group}, 速度: ${update.speed}`,
    )
    this.notify(key, full)
    return full
  }

  getSpeedUpdate(name: string, group: string): SpeedUpdate | undefined {
    const key = hashKey(name, group)
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.updatedAt > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }
    return { ...entry }
  }

  getSpeed(name: string, group: string): number {
    const update = this.getSpeedUpdate(name, group)
    return update ? update.speed : -1
  }

  async checkSpeed(
    name: string,
    group: string,
    url: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<SpeedUpdate> {
    this.setSpeed(name, group, {
      speed: -2,
      peak: 0,
      downloaded: 0,
      elapsed: 0,
    })
    try {
      const result: SpeedTestResult = await cmdTestSpeed(url, name, timeoutMs)
      return this.setSpeed(name, group, {
        speed: result.speed,
        peak: result.peak,
        downloaded: result.downloaded,
        elapsed: result.elapsedMs,
      })
    } catch (error) {
      console.error('[SpeedManager] 测速失败:', name, error)
      return this.setSpeed(name, group, {
        speed: 0,
        peak: 0,
        downloaded: 0,
        elapsed: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export default new SpeedManager()

/** Format a bytes/sec value into a human-readable throughput string. */
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
  let value = bytesPerSec
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const text =
    unitIndex === 0
      ? Math.round(value).toString()
      : value >= 100
        ? Math.round(value).toString()
        : value.toFixed(1)
  return `${text} ${units[unitIndex]}`
}
