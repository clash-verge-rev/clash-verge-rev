import { useCallback, useEffect, useRef, useState } from 'react'
import { type Message, type MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { setCacheData, useQuery } from '@/services/query-client'

const RECONNECT_DELAY_MS = 1000

interface SharedSubscriptionOwner {
  handleMessage: (data: string) => void
  onConnected?: (ws: MihomoWebSocket) => Promise<void> | void
  cleanup?: () => void
  isMounted: () => boolean
}

interface SharedSubscriptionEntry {
  refs: number
  ws: MihomoWebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connecting: boolean
  owners: Set<SharedSubscriptionOwner>
  activeOwner: SharedSubscriptionOwner | null
  closed: boolean
  connectWs: () => Promise<void>
  scheduleReconnect: () => Promise<void>
}

const sharedSubscriptions = new Map<string, SharedSubscriptionEntry>()
const subscriptionSnapshots = new Map<string, unknown>()

const getSubscriptionSnapshot = <T>(key: string) =>
  subscriptionSnapshots.get(key) as T | undefined

const writeSubscriptionSnapshot = <T>(key: string, data: T) => {
  subscriptionSnapshots.set(key, data)
  void setCacheData<T>([key], data)
}

const pickActiveOwner = (entry: SharedSubscriptionEntry) => {
  if (entry.activeOwner?.isMounted()) return entry.activeOwner

  for (const owner of entry.owners) {
    if (owner.isMounted()) {
      entry.activeOwner = owner
      return owner
    }
  }

  entry.activeOwner = null
  return null
}

const closeSharedSocket = async (entry: SharedSubscriptionEntry) => {
  const ws = entry.ws
  if (!ws) return

  entry.ws = null
  await ws.close()
}

const createSharedSubscriptionEntry = (
  connect: () => Promise<MihomoWebSocket>,
): SharedSubscriptionEntry => {
  const entry: SharedSubscriptionEntry = {
    refs: 0,
    ws: null,
    reconnectTimer: null,
    connecting: false,
    owners: new Set(),
    activeOwner: null,
    closed: false,
    connectWs: async () => {},
    scheduleReconnect: async () => {},
  }

  const clearReconnectTimer = () => {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = null
    }
  }

  entry.connectWs = async () => {
    if (entry.closed || entry.connecting || entry.ws) return

    entry.connecting = true
    try {
      const ws = await connect()
      if (entry.closed) {
        await ws.close()
        return
      }

      const owner = pickActiveOwner(entry)
      await owner?.onConnected?.(ws)
      if (entry.closed) {
        await ws.close()
        return
      }

      ws.addListener((msg: Message) => {
        if (msg.type !== 'Text') return
        const activeOwner = pickActiveOwner(entry)
        if (!activeOwner) return

        activeOwner.handleMessage(msg.data)
      })

      entry.ws = ws
      clearReconnectTimer()
    } catch (ignoreError) {
      if (!entry.closed && !entry.ws) {
        clearReconnectTimer()
        entry.reconnectTimer = setTimeout(entry.connectWs, RECONNECT_DELAY_MS)
      }
    } finally {
      entry.connecting = false
    }
  }

  entry.scheduleReconnect = async () => {
    if (entry.closed) return

    clearReconnectTimer()
    await closeSharedSocket(entry)
    if (!entry.closed) {
      entry.reconnectTimer = setTimeout(entry.connectWs, RECONNECT_DELAY_MS)
    }
  }

  return entry
}

type Updater<T> = (current?: T) => T

/**
 * Pass either a plain value or a functional updater; the updater is resolved
 * against the current subscription snapshot before the cache is written.
 */
type NextFn<T> = (data: T | Updater<T>) => void

interface HandlerContext<T> {
  next: NextFn<T>
  scheduleReconnect: () => Promise<void>
  isMounted: () => boolean
}

interface HandlerResult {
  handleMessage: (data: string) => void
  onConnected?: (ws: MihomoWebSocket) => Promise<void> | void
  cleanup?: () => void
}

interface UseMihomoWsSubscriptionOptions<T> {
  subscriptionKey: string | null
  fallbackData: T
  connect: () => Promise<MihomoWebSocket>
  /**
   * When > 0, coalesce rapid WebSocket messages by wrapping the `next`
   * function passed to `setupHandlers`.  Only the most recent value is
   * flushed, at most once per `throttleMs` milliseconds.
   *
   * Uses `setTimeout` (not `requestAnimationFrame`) so it keeps working
   * when the window is backgrounded or minimized.
   */
  throttleMs?: number
  setupHandlers: (ctx: HandlerContext<T>) => HandlerResult
}

export const useMihomoWsSubscription = <T>(
  options: UseMihomoWsSubscriptionOptions<T>,
) => {
  const { subscriptionKey, fallbackData, connect, throttleMs, setupHandlers } =
    options

  const subscriptionCacheKey = subscriptionKey
    ? `$sub$${subscriptionKey}`
    : null
  const lastSubscriptionCacheKeyRef = useRef<string | null>(null)
  if (subscriptionCacheKey) {
    lastSubscriptionCacheKeyRef.current = subscriptionCacheKey
  }
  const responseCacheKey =
    subscriptionCacheKey ?? lastSubscriptionCacheKeyRef.current

  // Bumping the epoch re-runs the subscription effect, rebuilding the shared
  // entry (and its captured `connect`/handler closures) under the same key.
  const [refreshEpoch, setRefreshEpoch] = useState(0)

  const response = useQuery<T>({
    queryKey: responseCacheKey ? [responseCacheKey] : ['$sub$__disabled__'],
    queryFn: () =>
      getSubscriptionSnapshot<T>(responseCacheKey!) ?? fallbackData,
    initialData: () =>
      getSubscriptionSnapshot<T>(responseCacheKey ?? '$sub$__disabled__') ??
      fallbackData,
    staleTime: Infinity,
    enabled: subscriptionCacheKey !== null,
  })

  useEffect(() => {
    if (!subscriptionCacheKey) return

    let isMounted = true
    let entry = sharedSubscriptions.get(subscriptionCacheKey)
    if (!entry) {
      entry = createSharedSubscriptionEntry(connect)
      sharedSubscriptions.set(subscriptionCacheKey, entry)
    }

    entry.refs += 1

    let throttleCleanup: (() => void) | undefined
    let wrappedNext: NextFn<T>

    const baseNext: NextFn<T> = (data) => {
      const resolved =
        typeof data === 'function'
          ? (data as Updater<T>)(
              getSubscriptionSnapshot<T>(subscriptionCacheKey),
            )
          : (data as T)
      writeSubscriptionSnapshot(subscriptionCacheKey, resolved)
    }

    if (throttleMs && throttleMs > 0) {
      let pendingData: T | Updater<T> | undefined
      let timerId: ReturnType<typeof setTimeout> | null = null

      const flush = () => {
        timerId = null
        if (pendingData !== undefined) {
          const data = pendingData
          pendingData = undefined
          baseNext(data)
        }
      }

      wrappedNext = (data) => {
        if (!timerId) {
          baseNext(data)
          timerId = setTimeout(flush, throttleMs)
        } else {
          pendingData = data
        }
      }

      throttleCleanup = () => {
        if (timerId) {
          clearTimeout(timerId)
          timerId = null
        }
      }
    } else {
      wrappedNext = baseNext
    }

    const {
      handleMessage: handleTextMessage,
      onConnected,
      cleanup,
    } = setupHandlers({
      next: wrappedNext,
      scheduleReconnect: entry.scheduleReconnect,
      isMounted: () => isMounted,
    })

    const owner: SharedSubscriptionOwner = {
      handleMessage: handleTextMessage,
      onConnected,
      cleanup: () => {
        throttleCleanup?.()
        cleanup?.()
      },
      isMounted: () => isMounted,
    }

    entry.owners.add(owner)
    if (!entry.activeOwner) {
      entry.activeOwner = owner
    }
    void entry.connectWs()

    return () => {
      isMounted = false
      entry.owners.delete(owner)
      owner.cleanup?.()

      if (entry.activeOwner === owner) {
        entry.activeOwner = null
        const nextOwner = pickActiveOwner(entry)
        if (entry.ws && nextOwner?.onConnected) {
          void nextOwner.onConnected(entry.ws)
        }
      }

      entry.refs -= 1
      if (entry.refs <= 0) {
        entry.closed = true
        if (entry.reconnectTimer) {
          clearTimeout(entry.reconnectTimer)
          entry.reconnectTimer = null
        }
        sharedSubscriptions.delete(subscriptionCacheKey)
        void closeSharedSocket(entry)
      }
    }
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, [subscriptionCacheKey, refreshEpoch])

  const refresh = useCallback(() => {
    if (subscriptionCacheKey) {
      writeSubscriptionSnapshot(subscriptionCacheKey, fallbackData)
    }
    setRefreshEpoch((epoch) => epoch + 1)
  }, [subscriptionCacheKey, fallbackData])

  const setData = useCallback(
    (data: T) => {
      if (responseCacheKey) {
        writeSubscriptionSnapshot(responseCacheKey, data)
      }
    },
    [responseCacheKey],
  )

  return { response, refresh, setData }
}
