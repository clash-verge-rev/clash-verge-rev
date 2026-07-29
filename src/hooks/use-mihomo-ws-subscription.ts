import { useLocalStorage } from 'foxact/use-local-storage'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import { type Message, type MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import {
  cleanupSubscriptionKeys,
  getCacheData,
  registerSubscriptionKey,
  removeCacheData,
  setCacheData,
  useQuery,
} from '@/services/query-client'

const RECONNECT_DELAY_MS = 1000

type WsLifecycleState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed'

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
  state: WsLifecycleState
  listenerUnsubscribe: (() => void) | null
  refHolders: Set<MutableRefObject<MihomoWebSocket | null>>
  owners: Set<SharedSubscriptionOwner>
  activeOwner: SharedSubscriptionOwner | null
  connectWs: () => Promise<void>
  scheduleReconnect: () => Promise<void>
}

const sharedSubscriptions = new Map<string, SharedSubscriptionEntry>()
const initialSubscriptionDate = Date.now()

const syncSharedWsRefs = (entry: SharedSubscriptionEntry) => {
  entry.refHolders.forEach((ref) => {
    ref.current = entry.ws
  })
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
  if (entry.state === 'closing' || entry.state === 'closed') return

  const ws = entry.ws
  entry.ws = null
  entry.listenerUnsubscribe?.()
  entry.listenerUnsubscribe = null
  entry.state = 'closing'
  syncSharedWsRefs(entry)

  if (ws) {
    try {
      await ws.close()
    } catch {
      // Ignore close errors; the socket may already be closed.
    }
  }

  entry.state = 'closed'
}

const createSharedSubscriptionEntry = (
  connect: () => Promise<MihomoWebSocket>,
): SharedSubscriptionEntry => {
  const entry: SharedSubscriptionEntry = {
    refs: 0,
    ws: null,
    reconnectTimer: null,
    state: 'idle',
    listenerUnsubscribe: null,
    refHolders: new Set(),
    owners: new Set(),
    activeOwner: null,
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
    if (entry.state !== 'idle' || entry.ws) return

    entry.state = 'connecting'
    const getState = () => entry.state
    try {
      const ws = await connect()
      if (getState() === 'closed' || getState() === 'closing') {
        await ws.close()
        return
      }

      entry.ws = ws
      entry.state = 'connected'
      syncSharedWsRefs(entry)
      clearReconnectTimer()

      const owner = pickActiveOwner(entry)
      if (owner?.onConnected) {
        await owner.onConnected(ws)
        if (getState() === 'closed' || getState() === 'closing') {
          await ws.close()
          return
        }
      }

      entry.listenerUnsubscribe = ws.addListener((msg: Message) => {
        if (entry.state === 'closed' || entry.state === 'closing') return
        if (msg.type !== 'Text') return
        const activeOwner = pickActiveOwner(entry)
        if (!activeOwner) return

        activeOwner.handleMessage(msg.data)
      })
    } catch (ignoreError) {
      if (getState() === 'connecting') {
        clearReconnectTimer()
        entry.reconnectTimer = setTimeout(entry.connectWs, RECONNECT_DELAY_MS)
      }
    } finally {
      if (getState() === 'connecting') {
        entry.state = 'idle'
      }
    }
  }

  entry.scheduleReconnect = async () => {
    const getState = () => entry.state
    if (getState() === 'closed' || getState() === 'closing') return

    clearReconnectTimer()
    await closeSharedSocket(entry)
    if (getState() === 'closed' || getState() === 'closing') return

    entry.state = 'idle'
    entry.reconnectTimer = setTimeout(entry.connectWs, RECONNECT_DELAY_MS)
  }

  return entry
}

/**
 * Mirrors SWR's MutatorCallback: consumers can pass either a plain value or a
 * functional updater `(current?: T) => T`.  The functional form is resolved
 * against the current cache entry before calling `setCacheData`.
 */
type NextFn<T> = (
  error?: any,
  data?: T | ((current?: T) => T | undefined),
) => void

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
  storageKey: string
  buildSubscriptKey: (date: number) => string | null
  /**
   * Prefix used to identify and clean up old subscription cache keys when the
   * subscription rotates (e.g. "getClashLog"). If omitted, no explicit prefix
   * cleanup is performed; the bounded cache will still cap total growth.
   */
  subscriptionPrefix?: string
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
  const {
    storageKey,
    buildSubscriptKey,
    subscriptionPrefix,
    fallbackData,
    connect,
    throttleMs,
    setupHandlers,
  } = options

  const [date, setDate] = useLocalStorage(storageKey, initialSubscriptionDate)
  const subscriptKey = buildSubscriptKey(date)
  const subscriptionCacheKey = subscriptKey ? `$sub$${subscriptKey}` : null
  const lastSubscriptionCacheKeyRef = useRef<string | null>(null)
  if (subscriptionCacheKey) {
    lastSubscriptionCacheKeyRef.current = subscriptionCacheKey
  }
  const responseCacheKey =
    subscriptionCacheKey ?? lastSubscriptionCacheKeyRef.current

  const wsRef = useRef<MihomoWebSocket | null>(null)

  const resolveNextData = useCallback(
    (
      data: T | ((current?: T) => T | undefined) | undefined,
      cacheKey: string,
    ): T => {
      if (typeof data === 'function') {
        const updater = data as (current?: T) => T | undefined
        const current = getCacheData<T>([cacheKey])
        return updater(current) ?? fallbackData
      }
      return data ?? fallbackData
    },
    [fallbackData],
  )

  const response = useQuery<T>({
    queryKey: responseCacheKey ? [responseCacheKey] : ['$sub$__disabled__'],
    queryFn: () => getCacheData<T>([responseCacheKey!]) ?? fallbackData,
    initialData: () =>
      getCacheData<T>([responseCacheKey ?? '$sub$__disabled__']) ??
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

    if (subscriptionPrefix) {
      registerSubscriptionKey(subscriptionPrefix, [subscriptionCacheKey])
      void cleanupSubscriptionKeys(subscriptionPrefix, [subscriptionCacheKey])
    }

    entry.refs += 1
    entry.refHolders.add(wsRef)
    wsRef.current = entry.ws

    let throttleCleanup: (() => void) | undefined
    let wrappedNext: NextFn<T>

    const baseNext: NextFn<T> = (error, data) => {
      if (error !== undefined && error !== null) {
        return
      }
      if (data === undefined) return
      const resolved = resolveNextData(data, subscriptionCacheKey)
      setCacheData<T>([subscriptionCacheKey], resolved)
    }

    if (throttleMs && throttleMs > 0) {
      let pendingData: T | ((current?: T) => T | undefined) | undefined
      let hasPending = false
      let timerId: ReturnType<typeof setTimeout> | null = null

      const flush = () => {
        timerId = null
        if (hasPending) {
          const data = pendingData
          pendingData = undefined
          hasPending = false
          baseNext(undefined, data)
        }
      }

      wrappedNext = (
        error?: any,
        data?: T | ((current?: T) => T | undefined),
      ) => {
        if (error !== undefined && error !== null) {
          baseNext(error, data)
          return
        }
        if (!timerId) {
          baseNext(undefined, data)
          timerId = setTimeout(flush, throttleMs)
        } else {
          pendingData = data
          hasPending = true
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
      entry.owners.delete(owner)
      owner.cleanup?.()

      isMounted = false
      entry.refHolders.delete(wsRef)
      wsRef.current = null

      if (entry.activeOwner === owner) {
        entry.activeOwner = null
        const nextOwner = pickActiveOwner(entry)
        if (entry.ws && nextOwner?.onConnected) {
          void nextOwner.onConnected(entry.ws)
        }
      }

      entry.refs = Math.max(0, entry.refs - 1)
      if (entry.refs <= 0) {
        sharedSubscriptions.delete(subscriptionCacheKey)
        void closeSharedSocket(entry)
        if (subscriptionPrefix) {
          void cleanupSubscriptionKeys(subscriptionPrefix, [
            subscriptionCacheKey,
          ])
        }
      }
    }
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, [subscriptionCacheKey])

  const refresh = useCallback(() => {
    if (subscriptionCacheKey) {
      removeCacheData([subscriptionCacheKey])
    }
    setDate(Date.now())
  }, [subscriptionCacheKey, setDate])

  return { response, refresh, subscriptionCacheKey: responseCacheKey, wsRef }
}
