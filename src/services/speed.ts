import {
  cmdCancelProxyDownloadSpeedTests,
  cmdTestProxyDownloadSpeed,
  readSpeedTestUrlsConfigFile,
  saveSpeedTestUrlsConfigFile,
  type ProxyDownloadSpeedResult,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import {
  appendTestLog,
  classifyTestError,
  getTestErrorMessage,
  getTestFailureStatus,
  sanitizeTestMessage,
  showTestErrorSummary,
  type TestErrorKind,
} from '@/services/test-log'
import { debugLog } from '@/utils/debug'

const hashKey = (name: string, group: string) => `${group ?? ''}::${name}`

export const DEFAULT_SPEED_TEST_DURATION_MS = 5000
export const DEFAULT_SPEED_TEST_MAX_BYTES = 50 * 1024 * 1024
export const DEFAULT_SPEED_TEST_TIMEOUT = 20000
export const DEFAULT_SPEED_TEST_CONCURRENCY = 6
export const MAX_SPEED_TEST_CONCURRENCY = 6
export const RETRY_SPEED_TEST_CONCURRENCY = 2
export const MIN_VALUE_SPEED = 1024 * 1024
export const MAX_LAT = 1000
export const MAX_JIT = 1000

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const SPEED_CACHE_STORAGE_KEY = 'clash-verge-download-speed-cache-v1'
const MAX_PERSISTED_SPEED_CACHE = 2000
const MAX_FAILURE_WINDOW = 20
const MAX_TARGETS = 20
const MAX_FAILURE_REASON_LENGTH = 180
const SOURCE_RETRY_FAILURE_COUNT = 5

export const LEGACY_SPEED_TEST_CONFIG: ISpeedTestUrlConfig = {
  version: 2,
  test_duration_ms: DEFAULT_SPEED_TEST_DURATION_MS,
  targets: [
    {
      name: 'cloudflare',
      url: 'https://speed.cloudflare.com/__down?bytes=52428800',
      region: 'Global',
      priority: 1,
      note: '最稳定首选，全球 PoP，永久有效',
    },
    {
      name: 'leaseweb-hkg',
      url: 'https://speedtest.hkg12.hk.leaseweb.net/100mb.bin',
      region: 'HK',
      priority: 1,
      note: '专用测速服务器，HTTPS，香港',
    },
    {
      name: 'leaseweb-tyo',
      url: 'https://speedtest.tyo11.jp.leaseweb.net/100mb.bin',
      region: 'JP',
      priority: 1,
      note: '专用测速服务器，HTTPS，东京',
    },
    {
      name: 'vultr-sgp',
      url: 'https://sgp-ping.vultr.com/vultr.com.100MB.bin',
      region: 'SG',
      priority: 1,
      note: 'Vultr 官方测速，新加坡',
    },
    {
      name: 'vultr-tyo',
      url: 'https://hnd-jp-ping.vultr.com/vultr.com.100MB.bin',
      region: 'JP',
      priority: 1,
      note: 'Vultr 官方测速，东京',
    },
    {
      name: 'vultr-lax',
      url: 'https://lax-ca-us-ping.vultr.com/vultr.com.100MB.bin',
      region: 'US-West',
      priority: 2,
      note: 'Vultr 官方测速，洛杉矶',
    },
    {
      name: 'vultr-nj',
      url: 'https://nj-us-ping.vultr.com/vultr.com.100MB.bin',
      region: 'US-East',
      priority: 2,
      note: 'Vultr 官方测速，新泽西',
    },
    {
      name: 'ovh-sgp',
      url: 'https://sgp.proof.ovh.net/files/100Mb.dat',
      region: 'SG',
      priority: 2,
      note: 'OVH 官方测速，新加坡',
    },
    {
      name: 'ovh-fra',
      url: 'https://fra.proof.ovh.net/files/100Mb.dat',
      region: 'EU',
      priority: 3,
      note: 'OVH 官方测速，法兰克福',
    },
    {
      name: 'hetzner-fsn',
      url: 'https://fsn1-speed.hetzner.com/100MB.bin',
      region: 'EU',
      priority: 3,
      note: 'Hetzner 官方测速，德国',
    },
  ],
}

export const DEFAULT_SPEED_TEST_CONFIG: ISpeedTestUrlConfig = {
  version: 2,
  test_duration_ms: DEFAULT_SPEED_TEST_DURATION_MS,
  targets: [
    {
      name: 'ovh-sgp',
      url: 'https://sgp.proof.ovh.net/files/100Mb.dat',
      region: 'SG',
      priority: 1,
      enabled: true,
      note: 'OVH 官方测速，新加坡，实测零失败',
      failures: [],
    },
    {
      name: 'ovh-fra',
      url: 'https://fra.proof.ovh.net/files/100Mb.dat',
      region: 'EU',
      priority: 2,
      enabled: true,
      note: 'OVH 官方测速，法兰克福，实测零失败',
      failures: [],
    },
    {
      name: 'hetzner-fsn',
      url: 'https://fsn1-speed.hetzner.com/100MB.bin',
      region: 'EU',
      priority: 3,
      enabled: true,
      note: 'Hetzner 官方测速，德国，实测零失败',
      failures: [],
    },
    {
      name: 'leaseweb-hkg',
      url: 'https://speedtest.hkg12.hk.leaseweb.net/100mb.bin',
      region: 'HK',
      priority: 4,
      enabled: true,
      note: 'Leaseweb 专用测速，香港，部分出口 IP 可能被拒',
      failures: [],
    },
    {
      name: 'leaseweb-tyo',
      url: 'https://speedtest.tyo11.jp.leaseweb.net/100mb.bin',
      region: 'JP',
      priority: 5,
      enabled: true,
      note: 'Leaseweb 专用测速，东京，部分出口 IP 可能被拒',
      failures: [],
    },
    {
      name: 'cloudflare',
      url: 'https://speed.cloudflare.com/__down?bytes=52428800',
      region: 'Global',
      priority: 6,
      enabled: true,
      note: 'Cloudflare 动态测速，全球 PoP；部分代理出口 IP 会被 403',
      failures: [],
    },
  ],
}

export interface SpeedUpdate {
  speed: number
  error?: string
  ttfb?: number
  bytes?: number
  measuredBytes?: number
  elapsed?: number
  warmup?: number
  sampleCount?: number
  dropCount?: number
  dropRate?: number
  stability?: number
  jitterMs?: number
  earlyEof?: boolean
  attempts?: number
  failures?: number
  failRate?: number
  qualityScore?: number
  errorKind?: TestErrorKind
  nodeRouteIssue?: boolean
  updatedAt: number
}

export interface DownloadSpeedOptions {
  config?: ISpeedTestUrlConfig
  maxBytes?: number
  timeout?: number
  concurrency?: number
  retryAttempt?: number
  onItemDone?: (name: string, update: SpeedUpdate) => void | Promise<void>
  onConfigChange?: (config: ISpeedTestUrlConfig) => void | Promise<void>
}

interface TargetRunStats {
  attempts: number
  successes: number
  failures: number
  earlyEofs: number
  totalSpeed: number
  totalTtfb: number
  totalMeasuredBytes: number
  lastError?: string
  lastErrorKind?: TestErrorKind
  worstErrorSeverity: number
  updatedAt?: string
}

interface TargetRunSession {
  stats: Map<string, TargetRunStats>
}

class SpeedManager {
  private cache = new Map<string, SpeedUpdate>()
  private persistedCache = new Map<string, SpeedUpdate>()
  private nodeFailures = new Map<string, boolean[]>()
  private listenerMap = new Map<string, (update: SpeedUpdate) => void>()
  private groupListenerMap = new Map<string, () => void>()
  private activeTests = new Map<string, { name: string; group: string }>()
  private pendingItemUpdates = new Map<string, SpeedUpdate[]>()
  private pendingGroupUpdates = new Set<string>()
  private itemFlushScheduled = false
  private groupFlushScheduled = false
  private cancelGeneration = 0

  constructor() {
    this.persistedCache = this.readPersistedCache()
    this.restorePersistedCache()
  }

  private scheduleOnNextFrame(run: () => void) {
    if (typeof window !== 'undefined') {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
        return
      }
      if (typeof window.setTimeout === 'function') {
        window.setTimeout(run, 0)
        return
      }
    }

    Promise.resolve().then(run)
  }

  private scheduleItemFlush() {
    if (this.itemFlushScheduled) return
    this.itemFlushScheduled = true
    this.scheduleOnNextFrame(() => {
      this.itemFlushScheduled = false
      const updates = this.pendingItemUpdates
      this.pendingItemUpdates = new Map()

      updates.forEach((queue, key) => {
        const listener = this.listenerMap.get(key)
        if (!listener) return
        queue.forEach((update) => {
          try {
            listener(update)
          } catch (error) {
            console.error(`[SpeedManager] listener failed: ${key}`, error)
          }
        })
      })
    })
  }

  private scheduleGroupFlush() {
    if (this.groupFlushScheduled) return
    this.groupFlushScheduled = true
    this.scheduleOnNextFrame(() => {
      this.groupFlushScheduled = false
      const groups = this.pendingGroupUpdates
      this.pendingGroupUpdates = new Set()
      groups.forEach((group) => {
        const listener = this.groupListenerMap.get(group)
        if (!listener) return
        try {
          listener()
        } catch (error) {
          console.error(`[SpeedManager] group listener failed: ${group}`, error)
        }
      })
    })
  }

  private queueGroupNotification(group: string) {
    this.pendingGroupUpdates.add(group)
    this.scheduleGroupFlush()
  }

  setListener(
    name: string,
    group: string,
    listener: (update: SpeedUpdate) => void,
  ) {
    this.listenerMap.set(hashKey(name, group), listener)
  }

  removeListener(name: string, group: string) {
    this.listenerMap.delete(hashKey(name, group))
  }

  setGroupListener(group: string, listener: () => void) {
    this.groupListenerMap.set(group, listener)
  }

  removeGroupListener(group: string) {
    this.groupListenerMap.delete(group)
  }

  async cancelAll() {
    this.cancelGeneration += 1
    const active = [...this.activeTests.values()]
    this.activeTests.clear()
    active.forEach(({ name, group }) => this.setSpeed(name, group, -1))
    try {
      await cmdCancelProxyDownloadSpeedTests()
    } catch (error) {
      console.warn('[SpeedManager] backend cancel failed', error)
    }
  }

  setSpeed(
    name: string,
    group: string,
    speed: number,
    meta?: Partial<
      Pick<
        SpeedUpdate,
        | 'error'
        | 'ttfb'
        | 'bytes'
        | 'measuredBytes'
        | 'elapsed'
        | 'warmup'
        | 'sampleCount'
        | 'dropCount'
        | 'dropRate'
        | 'stability'
        | 'jitterMs'
        | 'earlyEof'
        | 'errorKind'
        | 'nodeRouteIssue'
      >
    >,
  ): SpeedUpdate {
    const key = hashKey(name, group)
    const window = this.nodeFailures.get(key) ?? []
    const failures = window.filter(Boolean).length
    const failRate = failures / MAX_FAILURE_WINDOW
    const update: SpeedUpdate = {
      speed,
      error: speed === -3 || meta?.earlyEof ? meta?.error : undefined,
      ttfb: meta?.ttfb,
      bytes: meta?.bytes,
      measuredBytes: meta?.measuredBytes,
      elapsed: meta?.elapsed,
      warmup: meta?.warmup,
      sampleCount: meta?.sampleCount,
      dropCount: meta?.dropCount,
      dropRate: meta?.dropRate,
      stability: meta?.stability,
      jitterMs: meta?.jitterMs,
      earlyEof: meta?.earlyEof,
      attempts: window.length,
      failures,
      failRate,
      qualityScore: this.calculateQualityScore({
        speed,
        stability: meta?.stability,
        dropRate: meta?.dropRate,
        failRate,
        earlyEof: meta?.earlyEof,
        nodeRouteIssue: meta?.nodeRouteIssue,
      }),
      errorKind: meta?.errorKind,
      nodeRouteIssue: meta?.nodeRouteIssue,
      updatedAt: Date.now(),
    }

    this.cache.set(key, update)
    if (speed === -2) {
      this.activeTests.set(key, { name, group })
    } else {
      this.activeTests.delete(key)
    }
    if (speed !== -1 && speed !== -2) {
      this.persistSpeedUpdate(key, update)
    }

    const queue = this.pendingItemUpdates.get(key)
    if (queue) queue.push(update)
    else this.pendingItemUpdates.set(key, [update])

    this.scheduleItemFlush()
    this.queueGroupNotification(group)
    return update
  }

  getSpeedUpdate(name: string, group: string) {
    const key = hashKey(name, group)
    const entry = this.cache.get(key) ?? this.getPersistedUpdate(key)
    if (!entry) return undefined
    if (Date.now() - entry.updatedAt > CACHE_TTL) {
      this.cache.delete(key)
      this.removePersistedUpdate(key)
      return undefined
    }
    this.cache.set(key, entry)
    return { ...entry }
  }

  private restorePersistedCache() {
    const now = Date.now()
    let changed = false
    this.persistedCache.forEach((update, key) => {
      if (this.isPersistedUpdateValid(update, now)) {
        this.cache.set(key, update)
      } else {
        this.persistedCache.delete(key)
        changed = true
      }
    })
    if (changed) {
      this.writePersistedCache()
    }
  }

  private getPersistedUpdate(key: string) {
    const update = this.persistedCache.get(key)
    if (!update) return undefined
    if (!this.isPersistedUpdateValid(update)) {
      this.removePersistedUpdate(key)
      return undefined
    }
    return update
  }

  private persistSpeedUpdate(key: string, update: SpeedUpdate) {
    if (!this.isPersistableSpeed(update)) return

    this.persistedCache.set(key, update)
    this.writePersistedCache()
  }

  private removePersistedUpdate(key: string) {
    if (!this.persistedCache.delete(key)) return
    this.writePersistedCache()
  }

  private readPersistedCache() {
    const entries = new Map<string, SpeedUpdate>()
    if (typeof window === 'undefined' || !window.localStorage) return entries

    try {
      const raw = window.localStorage.getItem(SPEED_CACHE_STORAGE_KEY)
      if (!raw) return entries
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return entries

      Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
        const update = normalizePersistedSpeedUpdate(value)
        if (update) entries.set(key, update)
      })
    } catch (error) {
      console.warn('[SpeedManager] failed to read persisted speed cache', error)
    }

    return entries
  }

  private writePersistedCache() {
    if (typeof window === 'undefined' || !window.localStorage) return

    const now = Date.now()
    const compact = Array.from(this.persistedCache.entries())
      .filter(([, update]) => this.isPersistedUpdateValid(update, now))
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_PERSISTED_SPEED_CACHE)
    this.persistedCache = new Map(compact)

    try {
      window.localStorage.setItem(
        SPEED_CACHE_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(compact)),
      )
    } catch (error) {
      console.warn('[SpeedManager] failed to persist speed cache', error)
    }
  }

  private isPersistableSpeed(update: SpeedUpdate) {
    return update.speed > 0 || update.speed === -3 || Boolean(update.earlyEof)
  }

  private isPersistedUpdateValid(update: SpeedUpdate, now = Date.now()) {
    return (
      Number.isFinite(update.updatedAt) &&
      now - update.updatedAt <= CACHE_TTL &&
      this.isPersistableSpeed(update)
    )
  }

  getSortSpeed(name: string, group: string) {
    const update = this.getSpeedUpdate(name, group)
    if (!update || update.speed <= 0 || update.earlyEof) return -1
    return update.speed
  }

  getQualityScore(
    name: string,
    group: string,
    lat?: number,
    jitterMs?: number,
    latencyTimeout?: number,
  ) {
    const update = this.getSpeedUpdate(name, group)
    if (!update) return -1
    return this.calculateQualityScore({
      speed: update.speed,
      stability: update.stability,
      dropRate: update.dropRate,
      failRate: update.failRate,
      lat,
      jitterMs,
      latencyTimeout,
      earlyEof: update.earlyEof,
      nodeRouteIssue: update.nodeRouteIssue,
    })
  }

  isNodeRouteIssue(name: string, group: string) {
    return Boolean(this.getSpeedUpdate(name, group)?.nodeRouteIssue)
  }

  hasMeasuredFailure(name: string, group: string) {
    const update = this.getSpeedUpdate(name, group)
    return Boolean(update && (update.speed === -3 || update.earlyEof))
  }

  async checkSpeed(
    name: string,
    group: string,
    timeout: number,
    options?: DownloadSpeedOptions,
    generation = this.cancelGeneration,
  ) {
    const config = compactSpeedTestConfig(options?.config)
    await this.persistConfigChange(config, options)
    const session = this.createTargetRunSession()
    const update = await this.runSpeedTest(
      name,
      group,
      timeout,
      options,
      generation,
      { showErrorSummary: true },
      config,
      session,
    )

    if (!this.isCancelled(generation)) {
      this.adjustTargetPriorities(config, session, group, 'single')
      await this.persistConfigChange(config, options)
    }

    return update
  }

  async checkListSpeed(
    nameList: string[],
    group: string,
    timeout: number,
    options?: DownloadSpeedOptions,
  ) {
    const names = Array.from(new Set(nameList.filter(Boolean)))
    if (!names.length) return

    const generation = this.cancelGeneration
    const concurrency = this.resolveConcurrency(options?.concurrency, names.length)
    const config = compactSpeedTestConfig(options?.config)
    await this.persistConfigChange(config, options)
    const session = this.createTargetRunSession()
    names.forEach((name) => this.setSpeed(name, group, -2))

    debugLog(
      `[SpeedManager] batch speed test, group=${group}, count=${names.length}, concurrency=${concurrency}`,
    )

    let results = await this.runBatchWorkers(
      names,
      group,
      timeout,
      options,
      generation,
      concurrency,
      config,
      session,
    )
    if (this.isCancelled(generation)) return

    const failures = results.filter((result) => result.speed === -3)
    let retried = 0

    if (
      this.shouldRetryFailedNodes(failures.length, names.length) &&
      concurrency > RETRY_SPEED_TEST_CONCURRENCY
    ) {
      this.adjustTargetPriorities(config, session, group, 'before-retry')
      appendTestLog({
        kind: 'speed',
        status: 'retry',
        group,
        message: `Retrying ${failures.length}/${names.length} failed speed tests with concurrency ${RETRY_SPEED_TEST_CONCURRENCY}`,
      })

      failures.forEach((result) => this.setSpeed(result.name, group, -2))
      const retryResults = await this.runBatchWorkers(
        failures.map((result) => result.name),
        group,
        timeout,
        { ...options, retryAttempt: 1 },
        generation,
        RETRY_SPEED_TEST_CONCURRENCY,
        config,
        session,
      )
      retried = retryResults.length
      const resultMap = new Map(results.map((result) => [result.name, result]))
      retryResults.forEach((result) => resultMap.set(result.name, result))
      results = [...resultMap.values()]
    }
    if (this.isCancelled(generation)) return
    this.adjustTargetPriorities(config, session, group, 'final')
    await this.persistConfigChange(config, options)

    const finalFailures = results.filter((result) => result.speed === -3)
    showTestErrorSummary({
      kind: 'speed',
      total: names.length,
      failed: finalFailures.length,
      retried,
      message: this.summarizeFailureReasons(
        finalFailures.map((result) => result.error),
      ),
    })
  }

  private async runBatchWorkers(
    names: string[],
    group: string,
    timeout: number,
    options: DownloadSpeedOptions | undefined,
    generation: number,
    concurrency: number,
    config: ISpeedTestUrlConfig,
    session: TargetRunSession,
  ) {
    const results: Array<{ name: string; speed: number; error?: string }> = []
    let index = 0

    const worker = async () => {
      while (!this.isCancelled(generation)) {
        const currentIndex = index++
        const name = names[currentIndex]
        if (!name) return

        await this.waitForStartupStagger(currentIndex, concurrency)
        if (this.isCancelled(generation)) return

        const update = await this.runSpeedTest(
          name,
          group,
          timeout,
          options,
          generation,
          undefined,
          config,
          session,
        )
        results.push({ name, speed: update.speed, error: update.error })
        if (update.speed !== -3 || options?.retryAttempt) {
          await options?.onItemDone?.(name, update)
        }
      }
    }

    await Promise.allSettled(Array.from({ length: concurrency }, () => worker()))
    return results
  }

  private async waitForStartupStagger(itemIndex: number, concurrency: number) {
    if (concurrency <= 1) return
    const waveIndex = itemIndex % concurrency
    const delay = Math.min(1200, waveIndex * 160)
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  private async runSpeedTest(
    name: string,
    group: string,
    timeout: number,
    options: DownloadSpeedOptions | undefined,
    generation: number,
    runOptions?: { showErrorSummary?: boolean },
    config: ISpeedTestUrlConfig = normalizeSpeedTestConfig(options?.config),
    session = this.createTargetRunSession(),
  ): Promise<SpeedUpdate> {
    if (this.isCancelled(generation)) {
      appendTestLog({ kind: 'speed', status: 'cancelled', group, name })
      return this.setSpeed(name, group, -1)
    }

    this.setSpeed(name, group, -2)
    const targets = sortTargetsByPriority(config.targets ?? []).slice(0, MAX_TARGETS)
    let lastError = 'Download speed test failed'
    let lastErrorKind = classifyTestError(lastError)
    let lastNodeRouteIssue = false
    let lastTarget = targets[0]
    const durationMs =
      normalizePositiveInt(config.test_duration_ms) ??
      DEFAULT_SPEED_TEST_DURATION_MS

    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex]
      lastTarget = target
      const startedAt = Date.now()

      try {
        const result = await cmdTestProxyDownloadSpeed(
          group,
          name,
          target.url,
          options?.timeout ?? timeout,
          options?.maxBytes ?? DEFAULT_SPEED_TEST_MAX_BYTES,
          durationMs,
        )
        if (this.isCancelled(generation)) {
          appendTestLog({
            kind: 'speed',
            status: 'cancelled',
            group,
            name,
            target: target.name,
            region: target.region,
            priority: target.priority,
            elapsed: Date.now() - startedAt,
          })
          return this.setSpeed(name, group, -1)
        }

        const earlyEof = Boolean(result.earlyEof)
        if (earlyEof) {
          lastError = 'Early EOF before full measurement window'
          lastErrorKind = 'early_eof'
          lastNodeRouteIssue = false
          this.recordTargetFailure(config, target, lastError, session, 'early_eof')
          appendTestLog({
            kind: 'speed',
            status: 'early_eof',
            errorKind: 'early_eof',
            group,
            name,
            target: target.name,
            region: target.region,
            priority: target.priority,
            elapsed: result.elapsedMs,
            ttfb: result.ttfbMs,
            warmup: result.warmupMs,
            measuredBytes: result.measuredBytes,
            speed: result.bytesPerSecond,
            message: lastError,
          })
          continue
        }

        this.recordNodeAttempt(name, group, false)
        this.recordTargetSuccess(session, target, result)
        appendTestLog({
          kind: 'speed',
          status: 'success',
          group,
          name,
          target: target.name,
          region: target.region,
          priority: target.priority,
          elapsed: result.elapsedMs,
          ttfb: result.ttfbMs,
          warmup: result.warmupMs,
          measuredBytes: result.measuredBytes,
          speed: result.bytesPerSecond,
          retry: options?.retryAttempt,
        })
        return this.setSpeed(name, group, this.normalizeResultSpeed(result), {
          bytes: result.bytes,
          measuredBytes: result.measuredBytes,
          elapsed: result.elapsedMs,
          warmup: result.warmupMs,
          ttfb: result.ttfbMs,
          sampleCount: result.sampleCount,
          dropCount: result.dropCount,
          dropRate: result.dropRate,
          stability: result.stability,
          jitterMs: result.jitterMs,
          earlyEof: false,
        })
      } catch (error) {
        const message = sanitizeTestMessage(getTestErrorMessage(error))
        const errorKind = classifyTestError(message)
        const nodeRouteIssue = this.isNodeRouteIssueError(
          name,
          group,
          timeout,
          message,
          errorKind,
        )
        lastError = message
        lastErrorKind = errorKind
        lastNodeRouteIssue = nodeRouteIssue

        if (this.isCancelled(generation)) {
          appendTestLog({
            kind: 'speed',
            status: 'cancelled',
            group,
            name,
            target: target.name,
            region: target.region,
            priority: target.priority,
            elapsed: Date.now() - startedAt,
          })
          return this.setSpeed(name, group, -1)
        }

        if (!nodeRouteIssue) {
          this.recordTargetFailure(config, target, message, session, 'failure')
        }

        if (nodeRouteIssue) {
          break
        }

        const nextTarget = targets[targetIndex + 1]
        if (nextTarget) {
          appendTestLog({
            kind: 'speed',
            status: 'retry',
            errorKind,
            group,
            name,
            target: nextTarget.name,
            region: nextTarget.region,
            priority: nextTarget.priority,
            elapsed: Date.now() - startedAt,
            retry: options?.retryAttempt,
            message: `Fallback from ${target.name ?? 'target'}: ${sanitizeTestMessage(message)}`,
          })
          continue
        }
      }
    }

    this.recordNodeAttempt(name, group, true)
    appendTestLog({
      kind: 'speed',
      status: getTestFailureStatus(lastError),
      errorKind: lastErrorKind,
      group,
      name,
      target: lastTarget?.name,
      region: lastTarget?.region,
      priority: lastTarget?.priority,
      retry: options?.retryAttempt,
      message: lastError,
    })
    if (runOptions?.showErrorSummary) {
      showTestErrorSummary({
        kind: 'speed',
        total: 1,
        failed: 1,
        message: this.summarizeFailureReasons([lastError]),
      })
    }
    return this.setSpeed(name, group, -3, {
      error: lastError,
      errorKind: lastErrorKind,
      nodeRouteIssue: lastNodeRouteIssue,
    })
  }

  private isNodeRouteIssueError(
    name: string,
    group: string,
    timeout: number,
    message: string,
    kind: TestErrorKind,
  ) {
    const text = message.toLowerCase()
    if (/isolated mihomo proxy port|isolated.*proxy port/.test(text)) {
      return true
    }

    const delay = delayManager.getDelay(name, group)
    const delayTimedOut =
      delay === 0 ||
      (delay >= timeout && delay <= 1e5) ||
      delay > 1e5
    if (!delayTimedOut) return false

    return (
      kind === 'tls_handshake' ||
      kind === 'http_403' ||
      kind === 'timeout' ||
      kind === 'connection_reset' ||
      kind === 'connection_aborted' ||
      kind === 'proxy_connect'
    )
  }

  private recordNodeAttempt(name: string, group: string, failed: boolean) {
    const key = hashKey(name, group)
    const window = this.nodeFailures.get(key) ?? []
    window.push(failed)
    this.nodeFailures.set(key, window.slice(-MAX_FAILURE_WINDOW))
  }

  private recordTargetFailure(
    config: ISpeedTestUrlConfig,
    target: ISpeedTestUrlItem,
    error: string,
    session: TargetRunSession,
    status: 'failure' | 'early_eof',
  ) {
    const item = config.targets?.find((candidate) => candidate.url === target.url)
    if (!item) return

    this.recordTargetProblem(session, target, error, status)
    const errorKind =
      status === 'early_eof' ? 'early_eof' : classifyTestError(error)
    const timestamp = formatLocalTimestamp()
    const failure: ISpeedTestUrlFailure = {
      error: sanitizeTestMessage(error).slice(0, MAX_FAILURE_REASON_LENGTH),
      kind: errorKind,
      count: 1,
      first_at: timestamp,
      last_at: timestamp,
      at: timestamp,
    }
    item.failures = mergeTargetFailure(normalizeFailures(item.failures), failure)
    item.last_error = failure.error
    item.last_error_kind = errorKind
    item.updated_at = failure.at
  }

  private createTargetRunSession(): TargetRunSession {
    return { stats: new Map() }
  }

  private targetStats(session: TargetRunSession, target: ISpeedTestUrlItem) {
    const key = target.url
    const current = session.stats.get(key)
    if (current) return current

    const next: TargetRunStats = {
      attempts: 0,
      successes: 0,
      failures: 0,
      earlyEofs: 0,
      totalSpeed: 0,
      totalTtfb: 0,
      totalMeasuredBytes: 0,
      worstErrorSeverity: 0,
    }
    session.stats.set(key, next)
    return next
  }

  private recordTargetSuccess(
    session: TargetRunSession,
    target: ISpeedTestUrlItem,
    result: ProxyDownloadSpeedResult,
  ) {
    const stats = this.targetStats(session, target)
    stats.attempts += 1
    stats.successes += 1
    stats.totalSpeed += result.bytesPerSecond
    stats.totalTtfb += result.ttfbMs
    stats.totalMeasuredBytes += result.measuredBytes
    stats.updatedAt = formatLocalTimestamp()
  }

  private recordTargetProblem(
    session: TargetRunSession,
    target: ISpeedTestUrlItem,
    error: string,
    status: 'failure' | 'early_eof',
  ) {
    const stats = this.targetStats(session, target)
    const errorKind =
      status === 'early_eof' ? 'early_eof' : classifyTestError(error)
    stats.attempts += 1
    stats.failures += 1
    if (status === 'early_eof') {
      stats.earlyEofs += 1
    }
    stats.lastError = sanitizeTestMessage(error)
    stats.lastErrorKind = errorKind
    stats.worstErrorSeverity = Math.max(
      stats.worstErrorSeverity,
      errorKindSeverity(errorKind),
    )
    stats.updatedAt = formatLocalTimestamp()
  }

  private adjustTargetPriorities(
    config: ISpeedTestUrlConfig,
    session: TargetRunSession,
    group: string,
    phase: 'single' | 'before-retry' | 'final',
  ) {
    const targets = (config.targets ?? []).filter((target) => target.enabled !== false)
    if (!targets.length || session.stats.size === 0) return false

    const original = new Map(
      targets.map((target, index) => [
        target.url,
        {
          index,
          priority: normalizePositiveInt(target.priority) ?? 99,
        },
      ]),
    )

    const ordered = targets
      .slice()
      .sort((left, right) => compareTargetsByRun(left, right, session, original))

    let changed = false
    ordered.forEach((target, index) => {
      const nextPriority = index + 1
      if (target.priority !== nextPriority) {
        target.priority = nextPriority
        changed = true
      }
    })

    if (changed) {
      const first = ordered[0]
      const stats = first ? session.stats.get(first.url) : undefined
      appendTestLog({
        kind: 'speed',
        status: 'retry',
        group,
        target: first?.name,
        region: first?.region,
        priority: first?.priority,
        message: `Speed-test targets reprioritized (${phase}); best=${first?.name ?? 'none'}, success=${stats?.successes ?? 0}, fail=${stats?.failures ?? 0}`,
      })
    }

    return changed
  }

  private shouldRetryFailedNodes(failed: number, total: number) {
    if (failed <= 0 || total <= 0) return false
    const threshold = Math.min(SOURCE_RETRY_FAILURE_COUNT, Math.ceil(total / 2))
    return failed >= threshold
  }

  private async persistConfigChange(
    config: ISpeedTestUrlConfig,
    options: DownloadSpeedOptions | undefined,
  ) {
    const normalized = normalizeSpeedTestConfig(config)
    if (options?.onConfigChange) {
      await options.onConfigChange(normalized)
      return
    }

    try {
      await saveSpeedTestConfig(normalized)
    } catch (error) {
      console.warn('[SpeedManager] failed to persist speed test config', error)
    }
  }

  private normalizeResultSpeed(result: ProxyDownloadSpeedResult) {
    const speed = result.bytesPerSecond
    return Number.isFinite(speed) && speed > 0 ? speed : -3
  }

  private resolveConcurrency(value: number | undefined, total: number) {
    if (total <= 0) return 0
    const requested = Number.isFinite(value)
      ? Math.floor(value!)
      : DEFAULT_SPEED_TEST_CONCURRENCY
    return clamp(requested, 1, Math.min(MAX_SPEED_TEST_CONCURRENCY, total))
  }

  private isCancelled(generation: number) {
    return generation !== this.cancelGeneration
  }

  private calculateQualityScore(input: {
    speed: number
    stability?: number
    dropRate?: number
    lat?: number
    jitterMs?: number
    latencyTimeout?: number
    failRate?: number
    earlyEof?: boolean
    nodeRouteIssue?: boolean
  }) {
    if (
      input.nodeRouteIssue ||
      input.earlyEof ||
      !Number.isFinite(input.speed) ||
      input.speed < MIN_VALUE_SPEED
    ) {
      return 0
    }

    const stability = clamp(input.stability ?? 0, 0, 1)
    const dropRate = clamp(input.dropRate ?? 1, 0, 1)
    const latencyTimeout = input.latencyTimeout ?? 10000
    if (
      typeof input.lat === 'number' &&
      (input.lat === 0 || input.lat >= latencyTimeout || input.lat > 1e5)
    ) {
      return 0
    }

    const lat =
      typeof input.lat === 'number' && input.lat > 0 ? input.lat : MAX_LAT
    const jitterMs = input.jitterMs ?? MAX_JIT
    const failRate = clamp(input.failRate ?? 0, 0, 1)
    const floorSpeed = clamp(
      Math.log(input.speed / MIN_VALUE_SPEED + 1) / Math.log(11),
      0,
      1,
    )
    const latScore = clamp(1 - lat / MAX_LAT, 0, 1)
    const jitterScore = clamp(1 - jitterMs / MAX_JIT, 0, 1)

    return (
      stability * 0.35 +
      (1 - dropRate) * 0.25 +
      floorSpeed * 0.2 +
      latScore * 0.1 +
      jitterScore * 0.05 +
      (1 - failRate) * 0.05
    )
  }

  private summarizeFailureReasons(errors: Array<string | undefined>) {
    const reasons = errors
      .map((error) => (error ? sanitizeTestMessage(error) : undefined))
      .filter((reason): reason is string => Boolean(reason))
    if (!reasons.length) return undefined

    const counts = new Map<string, { count: number; sample: string }>()
    reasons.forEach((reason) => {
      const kind = classifyTestError(reason)
      const current = counts.get(kind)
      if (current) {
        current.count += 1
      } else {
        counts.set(kind, { count: 1, sample: reason })
      }
    })
    const [kind, info] = Array.from(counts.entries()).sort(
      (left, right) => right[1].count - left[1].count,
    )[0]
    const otherCount = reasons.length - info.count
    const main = `${kind} x${info.count}: ${info.sample}`
    return otherCount > 0 ? `${main}, other x${otherCount}` : main
  }

  formatSpeed(speed: number) {
    if (speed === -1) return '-'
    if (speed === -2) return 'testing'
    if (speed === -3 || !Number.isFinite(speed)) return 'Error'
    if (speed < 1024) return `${Math.round(speed)} B/s`
    if (speed < 1024 * 1024) return `${formatNumber(speed / 1024)} KB/s`
    return `${formatNumber(speed / 1024 / 1024)} MB/s`
  }

  formatSpeedColor(speed: number, earlyEof?: boolean) {
    if (speed === -3 || earlyEof) return 'error.main'
    if (speed < 0) return ''
    if (speed < 128 * 1024) return 'error.main'
    if (speed < 512 * 1024) return 'warning.main'
    if (speed < 2 * 1024 * 1024) return 'primary.main'
    return 'success.main'
  }
}

export default new SpeedManager()

export async function loadSpeedTestConfig() {
  try {
    return parseSpeedTestConfig(await readSpeedTestUrlsConfigFile())
  } catch {
    return normalizeSpeedTestConfig(DEFAULT_SPEED_TEST_CONFIG)
  }
}

export async function saveSpeedTestConfig(config: ISpeedTestUrlConfig) {
  await saveSpeedTestUrlsConfigFile(formatSpeedTestConfig(config))
}

export function parseSpeedTestConfig(content: string) {
  return normalizeSpeedTestConfig(JSON.parse(stripJsonBom(content)))
}

export function formatSpeedTestConfig(config: ISpeedTestUrlConfig) {
  return `${JSON.stringify(compactSpeedTestConfig(config), null, 2)}\n`
}

export function compactSpeedTestConfig(input?: ISpeedTestUrlConfig) {
  const normalized = normalizeSpeedTestConfig(input)
  const targets = (normalized.targets ?? [])
    .map((target, index) => ({ target, index }))
    .sort((left, right) => {
      const lp = normalizePositiveInt(left.target.priority) ?? 99
      const rp = normalizePositiveInt(right.target.priority) ?? 99
      if (lp !== rp) return lp - rp
      return left.index - right.index
    })
    .map(({ target }, index): ISpeedTestUrlItem => {
      const failures = normalizeFailures(target.failures).map(compactFailure)
      return {
        name: target.name,
        url: target.url,
        region: target.region ?? '',
        priority: index + 1,
        enabled: target.enabled !== false,
        note: target.note ?? '',
        failures,
      }
    })

  return {
    version: 2,
    test_duration_ms:
      normalizePositiveInt(normalized.test_duration_ms) ??
      DEFAULT_SPEED_TEST_DURATION_MS,
    targets,
  }
}

export function normalizeSpeedTestConfig(input?: ISpeedTestUrlConfig) {
  const source = input && typeof input === 'object' ? input : DEFAULT_SPEED_TEST_CONFIG
  const seen = new Set<string>()
  const targets = (Array.isArray(source.targets)
    ? source.targets
    : DEFAULT_SPEED_TEST_CONFIG.targets ?? []
  )
    .map((item, index): ISpeedTestUrlItem | null => {
      const url = normalizeUrl(item.url)
      if (!url || seen.has(url)) return null
      seen.add(url)
      return {
        name: item.name?.trim() || `target-${index + 1}`,
        url,
        region: item.region?.trim() || '',
        priority: normalizePositiveInt(item.priority) ?? 99,
        enabled: item.enabled !== false,
        note: item.note ?? '',
        failures: normalizeFailures(item.failures),
        last_error: item.last_error,
        last_error_kind: item.last_error_kind,
        updated_at: item.updated_at,
      }
    })
    .filter((item): item is ISpeedTestUrlItem => Boolean(item))

  return {
    version: 2,
    test_duration_ms:
      normalizePositiveInt(source.test_duration_ms) ??
      DEFAULT_SPEED_TEST_DURATION_MS,
    targets,
  }
}

function stripJsonBom(content: string) {
  return content.replace(/^\uFEFF/, '')
}

function sortTargetsByPriority(items: ISpeedTestUrlItem[]) {
  return items
    .filter((item) => item.enabled !== false)
    .slice()
    .sort((left, right) => {
      const lp = normalizePositiveInt(left.priority) ?? 99
      const rp = normalizePositiveInt(right.priority) ?? 99
      if (lp !== rp) return lp - rp
      const lf = failureCount(left.failures)
      const rf = failureCount(right.failures)
      if (lf !== rf) return lf - rf
      return dateValue(left.updated_at) - dateValue(right.updated_at)
    })
}

function compareTargetsByRun(
  left: ISpeedTestUrlItem,
  right: ISpeedTestUrlItem,
  session: TargetRunSession,
  original: Map<string, { index: number; priority: number }>,
) {
  const ls = session.stats.get(left.url)
  const rs = session.stats.get(right.url)
  const lc = targetRunCategory(ls)
  const rc = targetRunCategory(rs)
  if (lc !== rc) return lc - rc

  if (lc === 0) {
    const lSuccessRate = successRate(ls)
    const rSuccessRate = successRate(rs)
    if (lSuccessRate !== rSuccessRate) return rSuccessRate - lSuccessRate

    const lEarly = ls?.earlyEofs ?? 0
    const rEarly = rs?.earlyEofs ?? 0
    if (lEarly !== rEarly) return lEarly - rEarly

    const lFailure = ls?.failures ?? 0
    const rFailure = rs?.failures ?? 0
    if (lFailure !== rFailure) return lFailure - rFailure

    const lTtfb = averageTtfb(ls)
    const rTtfb = averageTtfb(rs)
    if (lTtfb !== rTtfb) return lTtfb - rTtfb

    const lSpeed = averageSpeed(ls)
    const rSpeed = averageSpeed(rs)
    if (lSpeed !== rSpeed) return rSpeed - lSpeed
  } else if (lc === 2) {
    const lFailureRate = failureRate(ls)
    const rFailureRate = failureRate(rs)
    if (lFailureRate !== rFailureRate) return lFailureRate - rFailureRate

    const lSeverity = ls?.worstErrorSeverity ?? 0
    const rSeverity = rs?.worstErrorSeverity ?? 0
    if (lSeverity !== rSeverity) return lSeverity - rSeverity

    const lFailures = ls?.failures ?? 0
    const rFailures = rs?.failures ?? 0
    if (lFailures !== rFailures) return lFailures - rFailures
  }

  const lRecent = failureCount(left.failures)
  const rRecent = failureCount(right.failures)
  if (lRecent !== rRecent) return lRecent - rRecent

  const lo = original.get(left.url) ?? { index: 0, priority: 99 }
  const ro = original.get(right.url) ?? { index: 0, priority: 99 }
  if (lo.priority !== ro.priority) return lo.priority - ro.priority
  return lo.index - ro.index
}

function targetRunCategory(stats: TargetRunStats | undefined) {
  if (stats && stats.successes > 0) return 0
  if (!stats || stats.attempts === 0) return 1
  return 2
}

function successRate(stats: TargetRunStats | undefined) {
  if (!stats || stats.attempts <= 0) return 0
  return stats.successes / stats.attempts
}

function failureRate(stats: TargetRunStats | undefined) {
  if (!stats || stats.attempts <= 0) return 0
  return stats.failures / stats.attempts
}

function averageSpeed(stats: TargetRunStats | undefined) {
  if (!stats || stats.successes <= 0) return 0
  return stats.totalSpeed / stats.successes
}

function averageTtfb(stats: TargetRunStats | undefined) {
  if (!stats || stats.successes <= 0) return Number.MAX_SAFE_INTEGER
  return stats.totalTtfb / stats.successes
}

function errorKindSeverity(kind: TestErrorKind) {
  switch (kind) {
    case 'early_eof':
      return 2
    case 'http_403':
      return 9
    case 'http_5xx':
      return 6
    case 'timeout':
      return 7
    case 'tls_handshake':
      return 8
    case 'connection_reset':
    case 'connection_aborted':
      return 7
    case 'dns':
      return 8
    case 'proxy_connect':
      return 6
    case 'no_data':
      return 5
    case 'network':
      return 6
    case 'unknown':
    default:
      return 5
  }
}

function normalizeUrl(url: string | undefined) {
  if (!url) return undefined
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return undefined

  try {
    const parsed = new URL(trimmed)
    if (!parsed.pathname || parsed.pathname === '/') {
      // /__down is the Cloudflare speed endpoint convention. Bare domains are
      // treated as Cloudflare-style endpoints; static speed-test hosts should
      // be configured with their real download path.
      parsed.pathname = '/__down'
      parsed.search = `?bytes=${DEFAULT_SPEED_TEST_MAX_BYTES}`
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}

function normalizeFailures(value: unknown): ISpeedTestUrlFailure[] {
  if (!Array.isArray(value)) return []

  const grouped = new Map<string, ISpeedTestUrlFailure>()
  value
    .filter((item): item is ISpeedTestUrlFailure => Boolean(item))
    .forEach((item) => {
      const error =
        typeof item.error === 'string'
          ? sanitizeTestMessage(item.error).slice(0, MAX_FAILURE_REASON_LENGTH)
          : undefined
      const kind =
        typeof item.kind === 'string'
          ? item.kind
          : error
            ? classifyTestError(error)
            : 'unknown'
      const key = kind || error || 'unknown'
      const count = clamp(normalizePositiveInt(item.count) ?? 1, 1, MAX_FAILURE_WINDOW)
      const firstAt = firstTimestamp(item.first_at, item.at, item.last_at)
      const lastAt = latestTimestamp(item.last_at, item.at, item.first_at)
      const current = grouped.get(key)

      if (!current) {
        grouped.set(key, {
          error,
          kind,
          count,
          first_at: firstAt,
          last_at: lastAt,
          at: lastAt,
        })
        return
      }

      current.count = (current.count ?? 1) + count
      current.error = error || current.error
      current.first_at = firstTimestamp(current.first_at, firstAt)
      current.last_at = latestTimestamp(current.last_at, lastAt)
      current.at = current.last_at
    })

  return capFailureWindow(
    Array.from(grouped.values()).sort(
      (left, right) =>
        dateValue(left.last_at ?? left.at) - dateValue(right.last_at ?? right.at),
    ),
  )
}

function mergeTargetFailure(
  failures: ISpeedTestUrlFailure[],
  failure: ISpeedTestUrlFailure,
) {
  return normalizeFailures(failures.concat(failure))
}

function compactFailure(failure: ISpeedTestUrlFailure): ISpeedTestUrlFailure {
  const error = failure.error
    ? sanitizeTestMessage(failure.error).slice(0, MAX_FAILURE_REASON_LENGTH)
    : undefined
  const kind = failure.kind || (error ? classifyTestError(error) : 'unknown')
  return {
    kind,
    count: failureEntryCount(failure),
    last_at: failure.last_at ?? failure.at ?? failure.first_at,
    error,
  }
}

function failureEntryCount(failure: ISpeedTestUrlFailure) {
  return clamp(normalizePositiveInt(failure.count) ?? 1, 1, MAX_FAILURE_WINDOW)
}

function failureCount(failures: unknown) {
  return normalizeFailures(failures).reduce(
    (sum, failure) => sum + failureEntryCount(failure),
    0,
  )
}

function capFailureWindow(failures: ISpeedTestUrlFailure[]) {
  const next = failures
    .map((failure) => ({
      ...failure,
      count: failureEntryCount(failure),
    }))
    .filter((failure) => failure.count! > 0)

  let total = next.reduce((sum, failure) => sum + failure.count!, 0)
  while (total > MAX_FAILURE_WINDOW && next.length > 0) {
    const first = next[0]
    const remove = Math.min(first.count!, total - MAX_FAILURE_WINDOW)
    first.count = first.count! - remove
    total -= remove
    if (first.count! <= 0) {
      next.shift()
    }
  }

  return next
}

function firstTimestamp(...values: Array<string | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value))
  if (!valid.length) return undefined
  return valid.sort((left, right) => dateValue(left) - dateValue(right))[0]
}

function latestTimestamp(...values: Array<string | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value))
  if (!valid.length) return undefined
  return valid.sort((left, right) => dateValue(right) - dateValue(left))[0]
}

function normalizePositiveInt(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.floor(parsed)
}

function dateValue(value: string | undefined) {
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60)
  const offsetRestMinutes = Math.abs(offsetMinutes) % 60

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}${offsetSign}${pad(offsetHours)}:${pad(offsetRestMinutes)}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatNumber(value: number) {
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function normalizePersistedSpeedUpdate(value: unknown): SpeedUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<SpeedUpdate>
  const speed = normalizeNumber(source.speed)
  const updatedAt = normalizeNumber(source.updatedAt)
  if (speed === undefined || updatedAt === undefined) return undefined

  const update: SpeedUpdate = {
    speed,
    updatedAt,
  }

  if (typeof source.error === 'string') {
    update.error = source.error
  }
  if (typeof source.errorKind === 'string') {
    update.errorKind = source.errorKind as TestErrorKind
  }

  const updateRecord = update as unknown as Record<string, unknown>
  const numberFields = [
    'ttfb',
    'bytes',
    'measuredBytes',
    'elapsed',
    'warmup',
    'sampleCount',
    'dropCount',
    'dropRate',
    'stability',
    'jitterMs',
    'attempts',
    'failures',
    'failRate',
    'qualityScore',
  ] as const
  numberFields.forEach((field) => {
    const next = normalizeNumber(source[field])
    if (next !== undefined) {
      updateRecord[field] = next
    }
  })

  if (typeof source.earlyEof === 'boolean') {
    update.earlyEof = source.earlyEof
  }
  if (typeof source.nodeRouteIssue === 'boolean') {
    update.nodeRouteIssue = source.nodeRouteIssue
  }

  return update
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
