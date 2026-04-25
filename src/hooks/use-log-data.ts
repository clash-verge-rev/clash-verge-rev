import { useQueryClient } from '@tanstack/react-query'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import dayjs from 'dayjs'
import { useEffect, useRef } from 'react'
import { MihomoWebSocket, type LogLevel } from 'tauri-plugin-mihomo-api'

import {
  getAppLogHistory,
  getClashLogs,
  type IAppLogRecord,
} from '@/services/cmds'

import { useClashLog } from './use-clash-log'
import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

const MAX_LOG_NUM = 1000
const FLUSH_DELAY_MS = 50
/**
 * 后端 app-log ring buffer 容量上限（见 logger.rs::APP_LOG_HISTORY_CAPACITY）。
 * seenSeqsRef 按此值的倍数做 dedup 裁剪：保留 2×ring 容量就够覆盖一次 history
 * replay 的全量 seq 集；被裁掉的 seq 一定早于 ring 里现存最小 seq，即使再次
 * 出现在 history 快照里也不会造成"已写入 cache 但被 dedup 误判"的冲突。
 */
const SEEN_SEQS_KEEP = 1000
/**
 * 高水位：Set 超过此值才触发裁剪。裁剪到 SEEN_SEQS_KEEP。两者之间的差额避免
 * 每条 add 都排序一次的抖动；事件风暴下约每 1000 次 add 触发一次 sort + 重建。
 */
const SEEN_SEQS_HIGH_WATERMARK = SEEN_SEQS_KEEP * 2

type LogType = ILogItem['type']

const DEFAULT_LOG_TYPES: LogType[] = ['debug', 'info', 'warning', 'error']
const LOG_LEVEL_FILTERS: Record<LogLevel, LogType[]> = {
  debug: DEFAULT_LOG_TYPES,
  info: ['info', 'warning', 'error'],
  warning: ['warning', 'error'],
  error: ['error'],
  silent: [],
}

/**
 * 后端 `clash_verge_logging::logging!` 宏白名单类型触发的 tauri event payload。
 * 与 `src-tauri/src/core/logger.rs::AppLogRecord` 对齐（camelCase 字段）。
 * `level` 来自 Rust `log` crate 的 `Level` 字符串（"debug" / "info" / "warn" /
 * "error" / "trace"），与 mihomo WebSocket 的 "warning" 命名不同，需 normalize。
 * `seq` 是后端原子计数器分配的单调序号，用于前端 live listener 与 history
 * replay 之间的去重（见 `seenSeqsRef`）。
 */
interface AppLogPayload {
  seq: number
  /**
   * 可选：后端 `SystemTime::now() - UNIX_EPOCH` 失败时省略（时钟回拨等
   * 异常场景），渲染端回落到 `Date.now()` 当作接收时刻，避免显示 1970-01-01。
   */
  unixMs?: number
  level: string
  source: string
  message: string
}

/**
 * Rust `log` crate level 名称与前端 LogType 不完全一致（`warn` vs `warning`；
 * `trace` 无对应）。前端过滤器只支持 `debug` / `info` / `warning` / `error`，
 * 故把 `warn` 归一化为 `warning`，`trace` 归到 `debug`（冗余信息类别）。未知
 * level 保守归到 `info`，避免事件被静默丢。
 */
const normalizeLogLevel = (level: string): LogType => {
  switch (level) {
    case 'debug':
    case 'info':
    case 'error':
      return level
    case 'warning':
    case 'warn':
      return 'warning'
    case 'trace':
      return 'debug'
    default:
      return 'info'
  }
}

const clampLogs = (logs: ILogItem[]): ILogItem[] =>
  logs.length > MAX_LOG_NUM ? logs.slice(-MAX_LOG_NUM) : logs

/**
 * 标记 seq 为"已写入 cache"。超过高水位后保留最新的 `SEEN_SEQS_KEEP` 个 seq,
 * 防止长 session（几小时不 unmount、事件风暴）下 Set 无限增长——每条 u32 seq
 * 在 V8 中约 50-80 bytes（含 hash 桶开销），100K 元素 ~6 MB 常驻。裁剪不影响
 * dedup 正确性：seq 单调递增，被裁掉的 seq 必定早于 ring buffer 里现存最小
 * seq，后续 `getAppLogHistory` 快照里永不出现。
 */
const markSeqSeen = (set: Set<number>, seq: number): void => {
  set.add(seq)
  if (set.size > SEEN_SEQS_HIGH_WATERMARK) {
    const sorted = [...set].sort((a, b) => b - a)
    const kept = sorted.slice(0, SEEN_SEQS_KEEP)
    set.clear()
    for (const s of kept) set.add(s)
  }
}

const filterLogsByLevel = (
  logs: ILogItem[],
  allowedTypes: LogType[],
): ILogItem[] => {
  if (allowedTypes.length === 0) return []
  if (allowedTypes.length === DEFAULT_LOG_TYPES.length) return logs
  return logs.filter((log) => allowedTypes.includes(log.type))
}

const appendLogs = (
  current: ILogItem[] | undefined,
  incoming: ILogItem[],
): ILogItem[] => {
  const base = current ?? []
  const total = base.length + incoming.length
  if (total <= MAX_LOG_NUM) return base.concat(incoming)
  const dropFromBase = total - MAX_LOG_NUM
  if (dropFromBase >= base.length) {
    return incoming.slice(incoming.length - MAX_LOG_NUM)
  }
  return base.slice(dropFromBase).concat(incoming)
}

export const useLogData = () => {
  const queryClient = useQueryClient()
  const [clashLog] = useClashLog()
  const enableLog = clashLog.enable
  const logLevel = clashLog.logLevel
  const allowedTypes = LOG_LEVEL_FILTERS[logLevel] ?? DEFAULT_LOG_TYPES
  // `onConnected` 在每次 WebSocket 连通时从 `getClashLogs()` 读历史 mihomo 日志，
  // 并从 `getAppLogHistory()` 读 app-log ring buffer 快照。两者命中的失败/成功
  // 场景独立——若合并进单个 sentinel，`getAppLogHistory` 瞬时 IPC 失败会让
  // 整个 key 的 session 永久不再重试（即使 mihomo 历史已成功拉取）。分开追踪:
  // 1. 同一 key 重连不重复拉取同一侧历史（前置 sentinel 短路 IPC）；
  // 2. 用户切 `logLevel` 触发 `refresh()` → 新 `subscriptionCacheKey` → 允许
  //    新 session 重新 prepend 一次历史；
  // 3. 并发到达的 `app-log` tauri event 写 cache 不会把"历史分支"跳过（详情见
  //    onConnected 处注释）。
  // 4. 某一侧 IPC 失败时另一侧仍然可能需要重试——两个 ref 独立推进。
  //
  // **重要前提**：下方 `loadedClashHistoryKeyRef` / `loadedAppLogHistoryKeyRef`
  // / `seenSeqsRef` 均是 `useRef`，会随 `useLogData` 所在组件 mount/unmount
  // 重置。当前正确性依赖 `pages/_layout.tsx` 的"永久挂载"模式（LogsPage 用
  // `display: none` 切换可见性而非 unmount/re-mount）。如果未来把 LogsPage
  // 改成按路由真正 mount/unmount，在 `gcTime`（TanStack Query 默认 30s）未
  // 到之前切走再回来，query cache 仍在但 ref 归零——`hasExisting` 判据仍命中
  // （cache 非空）但 `loadedKey === null !== current key` → 历史会被**重复**
  // prepend 一次。修路由时请同步把 sentinel 迁到更持久的存储（Context / atom
  // / Query meta），或把 LogsPage 保持为"display 切换"。
  const loadedClashHistoryKeyRef = useRef<string | null>(null)
  const loadedAppLogHistoryKeyRef = useRef<string | null>(null)
  // 后端 `app-log` ring buffer 每条 record 带单调 `seq`。本 Set 记录本 mount
  // session 内已写入日志 cache 的 seq，用于去重 live listener 和 history replay
  // 的竞态窗口：
  //   t0  mount → useEffect 注册 listen('app-log') (< 1 ms)
  //   t0+ε emit 发生 → listener 接收 seq=X → append
  //   t1  onConnected → getAppLogHistory 返回（含 seq=X）
  // 不 dedup 会让 seq=X 同时出现在 live append 的尾部和 history prepend 的中段。
  // 用 seq 做 O(1) 去重，Set 在 LogPage unmount 时 GC，每次 mount 重建——新 session
  // 里历史 seq 不会与 live 冲突（live listener 从新 session 的第一条才开始 add）。
  const seenSeqsRef = useRef<Set<number>>(new Set())

  const { response, refresh, subscriptionCacheKey } = useMihomoWsSubscription<
    ILogItem[]
  >({
    storageKey: 'mihomo_logs_date',
    buildSubscriptKey: (date) => (enableLog ? `getClashLog-${date}` : null),
    fallbackData: [],
    connect: () => MihomoWebSocket.connect_logs(logLevel),
    setupHandlers: ({ next, scheduleReconnect, isMounted }) => {
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const buffer: ILogItem[] = []
      let flushTimeStr: string | null = null

      const clearFlushTimer = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
      }

      const flush = () => {
        if (!buffer.length || !isMounted()) {
          flushTimer = null
          return
        }
        const pendingLogs = buffer.splice(0, buffer.length)
        flushTimeStr = null
        next(null, (current) => appendLogs(current, pendingLogs))
        flushTimer = null
      }

      return {
        handleMessage: (data) => {
          if (data.startsWith('Websocket error')) {
            next(data)
            void scheduleReconnect()
            return
          }

          try {
            const parsed = JSON.parse(data) as ILogItem
            // 与 onConnected、app-log live listener 一致走 `allowedTypesRef`,
            // 避免 setupHandlers closure 停在旧 `allowedTypes` 的潜在漂移——
            // 当前依靠 `logLevel` 切换会同时换 `subscriptionCacheKey` 导致
            // effect 重建来隐式刷新 closure，但一旦 refresh() 被重构成同 key，
            // closure 会拿过时值；与 25e78ae3 对 onConnected 的 ref 对齐策略
            // 同原则，此处也走 ref。
            const allowedTypesNow = allowedTypesRef.current
            if (
              allowedTypesNow.length > 0 &&
              !allowedTypesNow.includes(parsed.type)
            ) {
              return
            }
            if (flushTimeStr === null) {
              flushTimeStr = dayjs().format('MM-DD HH:mm:ss')
            }
            parsed.time = flushTimeStr
            buffer.push(parsed)
            if (buffer.length > MAX_LOG_NUM) {
              buffer.splice(0, buffer.length - MAX_LOG_NUM)
            }
            if (!flushTimer) {
              flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
            }
          } catch (error) {
            next(error)
          }
        },
        async onConnected() {
          // 前置 sentinel：clash 和 app-log 两侧独立追踪 "已加载"。合用单个
          // sentinel 会让某一侧 IPC 瞬时失败污染另一侧的 "已加载" 标记，下次
          // same key 重连直接短路，永远不再重试失败的那一侧。每侧的短路判据
          // 都是 `(loadedKey === current key) && cache 仍非空`；hasExisting
          // 用 `queryClient.getQueryData` 实时查 cache——仅按 key 做哨兵会在
          // "cache 因 gcTime 过期被 GC 后同 key 重连" 时错过历史重载；用 key
          // 对比（而非 boolean）让 `refresh()` 的新 key 自然允许再加载一次。
          if (!isMounted()) return
          const existingBefore = queryClient.getQueryData<ILogItem[]>([
            subscriptionCacheKey,
          ])
          const hasExistingBefore = (existingBefore?.length ?? 0) > 0
          const clashAlreadyLoaded =
            loadedClashHistoryKeyRef.current === subscriptionCacheKey &&
            hasExistingBefore
          const appLogAlreadyLoaded =
            loadedAppLogHistoryKeyRef.current === subscriptionCacheKey &&
            hasExistingBefore
          if (clashAlreadyLoaded && appLogAlreadyLoaded) return
          // 两侧并行拉取。之前写的是 "并行" 但实际串行 await（先 clash 后
          // app-log），IPC 延迟叠加——事件风暴下 app-log ring buffer 可能
          // 在这段额外延迟里淘汰掉最早的启动日志。用 Promise.all 让两个 IPC
          // 真正并发；单侧已 loaded 时用 Promise.resolve(null) 跳过 IPC。
          // app-log 分支 catch 时降级到 null（非 []），区分 "成功但为空" 与
          // "失败"，只在成功时 mark loaded，留给下次同 key 连接重试。
          // 两侧 IPC 失败都降级到 null（"跳过/失败" 语义），让 Promise.all 不
          // 抛错——一旦抛出，上游 useMihomoWsSubscription 在 onConnected 之后
          // 才调 `addListener`（见其 connectWs 实现），ws 已建立但 message
          // handler 从未注册，mihomo 实时日志会静默断流；此 catch 对称是必须
          // 的（不是美观改进）。
          const logsPromise: Promise<ILogItem[] | null> = clashAlreadyLoaded
            ? Promise.resolve(null)
            : getClashLogs().catch((err: unknown) => {
                console.warn('[useLogData] failed to fetch clash logs:', err)
                return null
              })
          const appLogHistoryPromise: Promise<IAppLogRecord[] | null> =
            appLogAlreadyLoaded
              ? Promise.resolve(null)
              : getAppLogHistory().catch((err: unknown) => {
                  // 静默 catch 会让 "为什么 [Network] 历史不见了" 这类用户
                  // 报告几乎无法定位；webview console 能被 dev tools 抓到，
                  // 对最终用户也无打扰。
                  console.warn(
                    '[useLogData] failed to fetch app-log history:',
                    err,
                  )
                  return null
                })
          const [logs, appLogHistory] = await Promise.all([
            logsPromise,
            appLogHistoryPromise,
          ])
          // 后置 double-check：防并发 onConnected 重复 prepend。判据与前置一致。
          if (!isMounted()) return
          const existingAfter = queryClient.getQueryData<ILogItem[]>([
            subscriptionCacheKey,
          ])
          const hasExistingAfter = (existingAfter?.length ?? 0) > 0
          const clashLoadedAfter =
            loadedClashHistoryKeyRef.current === subscriptionCacheKey &&
            hasExistingAfter
          const appLogLoadedAfter =
            loadedAppLogHistoryKeyRef.current === subscriptionCacheKey &&
            hasExistingAfter
          if (clashLoadedAfter && appLogLoadedAfter) return
          // 只在成功返回时 mark loaded（null 表示该侧本轮跳过或失败）。
          if (!clashLoadedAfter && logs !== null) {
            loadedClashHistoryKeyRef.current = subscriptionCacheKey
          }
          if (!appLogLoadedAfter && appLogHistory !== null) {
            loadedAppLogHistoryKeyRef.current = subscriptionCacheKey
          }
          // seq 去重：live listener 在 onConnected await 期间可能已经把某些
          // app-log 事件 append 到 cache（并把它们的 seq 加入 seenSeqsRef）。
          // 这些事件不能再次 prepend。
          //
          // **先过 level 过滤再记 seq**：若先 add 再过滤，用户先用严格 level
          // 打开日志页（过滤掉 warning/info），这些 seq 已被"看过"；后续切到
          // debug 并触发 refresh() 时，history 回放同一批 seq 会被 dedup 跳过
          // ——旧 app-log 永久丢失。只对"真正写入 cache"的 seq 记 dedup。
          // 快照一份当前 allowedTypes：与 live listener 的 `allowedTypesRef.current`
          // 取值对齐，避免 closure 捕获过时 `allowedTypes`（当前靠 `refresh()`
          // 换 subscriptionCacheKey → effect 重建 → 新 closure 隐式获得最新值,
          // 但这依赖 "logLevel 切换必然换 cache key" 的隐式契约；未来若
          // `refresh()` 被重构成不换 key，history 过滤与 listener 过滤会出现
          // 级别不一致的漂移）。
          const allowedTypesSnapshot = allowedTypesRef.current
          const appHistoricalItems: ILogItem[] = []
          for (const record of appLogHistory ?? []) {
            const level = normalizeLogLevel(record.level)
            if (!allowedTypesSnapshot.includes(level)) continue
            if (seenSeqsRef.current.has(record.seq)) continue
            markSeqSeen(seenSeqsRef.current, record.seq)
            appHistoricalItems.push({
              type: level,
              source: record.source,
              time: dayjs(record.unixMs ?? Date.now()).format('MM-DD HH:mm:ss'),
              payload: record.message,
            })
          }
          // 历史日志 prepend 到 cache 前面：`app-log` listener 在 `onConnected`
          // 之前就可能收到 tauri event 并写 cache，不能再用 "current 为空" 做
          // 哨兵——否则历史 mihomo 日志会被丢弃。app-log history 按 seq 升序
          // 放在 mihomo 历史之后，保持大致的时间序。
          next(null, (current) => {
            const clashHistorical = logs
              ? filterLogsByLevel(logs, allowedTypesSnapshot)
              : []
            return clampLogs([
              ...clashHistorical,
              ...appHistoricalItems,
              ...(current ?? []),
            ])
          })
        },
        cleanup: clearFlushTimer,
      }
    },
  })

  const previousLogLevelRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!logLevel) {
      previousLogLevelRef.current = logLevel ?? undefined
      return
    }

    if (previousLogLevelRef.current === logLevel) {
      return
    }

    previousLogLevelRef.current = logLevel
    refresh()
  }, [logLevel, refresh])

  // 订阅后端 `app-log` tauri event（`clash_verge_logging::logging!` 白名单类型
  // 触发，当前仅 `[Network]` 前缀，由 `core/logger.rs::AppLogFilter` 产生）。
  // 与 mihomo WebSocket 日志合流到同一 query cache，用户能在 GUI 日志列表实时
  // 看到 netmon 等应用侧事件。
  //
  // **已知低概率窗口**：`listen('app-log')` 返回 Promise，注册完成前存在极短
  // 的时间片（Tauri 下通常 <1 ms，无 IPC 往返）；同一窗口内若后端 emit 了 record
  // 且 onConnected 刚刚拿到 `getAppLogHistory()` 快照，这条 record 可能既不在
  // 快照里、也未被 live listener 接住，造成单条丢失。接受此降级：文件日志仍
  // 记录完整，下次 LogsPage 重 mount / key 切换会从 ring buffer 再次拉到（只
  // 要它没被 FIFO 淘汰）。严格消除需要把 listener 注册与 onConnected 串行化
  // （改 useMihomoWsSubscription 的调用契约），成本显著高于该窗口的影响。
  const allowedTypesRef = useRef(allowedTypes)
  allowedTypesRef.current = allowedTypes

  useEffect(() => {
    // `subscriptionCacheKey` 为 null 时（enableLog=false 或 storageKey 未 ready）
    // 不注册 listener；有 key 说明上游 WebSocket 订阅已激活，此时合流 app-log
    if (!subscriptionCacheKey) return
    // key 切换（例如切 logLevel 触发 refresh() 换 date）时重置 seenSeqsRef：
    // 新 key 的 query cache 是独立的，旧 key 已写入的 seq 不再是"当前 cache
    // 已有"的事实——若不重置，getAppLogHistory() 返回包含旧 seq 的快照会被
    // 全量误 dedup，app-log 历史段整体消失。useRef 跨 deps 变化保持引用，
    // 必须在 effect 起始显式清空。
    seenSeqsRef.current = new Set()
    let unlisten: UnlistenFn | null = null
    let active = true

    listen<AppLogPayload>('app-log', ({ payload }) => {
      if (!active) return
      // **先过 level 过滤再记 seq**（与 onConnected history 分支同策略）：
      // 若先 add 再过滤，过滤掉的 seq 会污染 seenSeqsRef，之后切宽 logLevel
      // 触发 refresh() 时 history 回放这些 seq 被误 dedup → app-log 永久丢失。
      const level = normalizeLogLevel(payload.level)
      if (!allowedTypesRef.current.includes(level)) return
      // seq 去重：若同条 record 已通过 onConnected 的 history replay 写入 cache,
      // 或并发 listener 已处理过（当前只注册 1 个，防御性），跳过重复 append。
      if (seenSeqsRef.current.has(payload.seq)) return
      markSeqSeen(seenSeqsRef.current, payload.seq)
      const item: ILogItem = {
        type: level,
        source: payload.source,
        time: dayjs(payload.unixMs ?? Date.now()).format('MM-DD HH:mm:ss'),
        payload: payload.message,
      }
      queryClient.setQueryData<ILogItem[]>([subscriptionCacheKey], (current) =>
        clampLogs([...(current ?? []), item]),
      )
    }).then((fn) => {
      if (active) unlisten = fn
      else fn()
    })

    return () => {
      active = false
      if (unlisten) unlisten()
    }
  }, [subscriptionCacheKey, queryClient])

  const refreshGetClashLog = (clear = false) => {
    if (clear) {
      if (subscriptionCacheKey) {
        queryClient.setQueryData<ILogItem[]>([subscriptionCacheKey], [])
      }
    } else {
      refresh()
    }
  }

  return { response, refreshGetClashLog }
}
