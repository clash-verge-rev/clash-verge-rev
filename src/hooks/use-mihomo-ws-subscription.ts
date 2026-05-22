import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalStorage } from 'foxact/use-local-storage'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import { type Message, type MihomoWebSocket } from 'tauri-plugin-mihomo-api'

export const RECONNECT_DELAY_MS = 1000

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
  refHolders: Set<MutableRefObject<MihomoWebSocket | null>>
  owners: Set<SharedSubscriptionOwner>
  activeOwner: SharedSubscriptionOwner | null
  closed: boolean
  connectWs: () => Promise<void>
  scheduleReconnect: () => Promise<void>
}

const sharedSubscriptions = new Map<string, SharedSubscriptionEntry>()

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
  const ws = entry.ws
  if (!ws) return

  entry.ws = null
  syncSharedWsRefs(entry)
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
    refHolders: new Set(),
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

      entry.ws = ws
      syncSharedWsRefs(entry)
      clearReconnectTimer()

      const owner = pickActiveOwner(entry)
      if (owner?.onConnected) {
        await owner.onConnected(ws)
        if (entry.closed) {
          await ws.close()
          return
        }
      }

      ws.addListener((msg: Message) => {
        if (msg.type !== 'Text') return
        const activeOwner = pickActiveOwner(entry)
        if (!activeOwner) return

        activeOwner.handleMessage(msg.data)
      })
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

/**
 * Mirrors SWR's MutatorCallback: consumers can pass either a plain value or a
 * functional updater `(current?: T) => T`.  The functional form is resolved
 * against the current cache entry before calling `queryClient.setQueryData`.
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
    fallbackData,
    connect,
    throttleMs,
    setupHandlers,
  } = options

  // eslint-disable-next-line @eslint-react/purity
  const [date, setDate] = useLocalStorage(storageKey, Date.now())
  const subscriptKey = buildSubscriptKey(date)
  const subscriptionCacheKey = subscriptKey ? `$sub$${subscriptKey}` : null
  const lastSubscriptionCacheKeyRef = useRef<string | null>(null)
  if (subscriptionCacheKey) {
    lastSubscriptionCacheKeyRef.current = subscriptionCacheKey
  }
  const responseCacheKey =
    subscriptionCacheKey ?? lastSubscriptionCacheKeyRef.current

  const queryClient = useQueryClient()

  const wsRef = useRef<MihomoWebSocket | null>(null)

  const resolveNextData = useCallback(
    (
      data: T | ((current?: T) => T | undefined) | undefined,
      cacheKey: string,
    ): T => {
      if (typeof data === 'function') {
        const updater = data as (current?: T) => T | undefined
        const current = queryClient.getQueryData<T>([cacheKey])
        return updater(current) ?? fallbackData
      }
      return data ?? fallbackData
    },
    [queryClient, fallbackData],
  )

  const response = useQuery<T>({
    queryKey: responseCacheKey ? [responseCacheKey] : ['$sub$__disabled__'],
    queryFn: () =>
      queryClient.getQueryData<T>([responseCacheKey!]) ?? fallbackData,
    initialData: () =>
      queryClient.getQueryData<T>([responseCacheKey ?? '$sub$__disabled__']) ??
      fallbackData,
    staleTime: Infinity,
    gcTime: 30_000,
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
      queryClient.setQueryData<T>([subscriptionCacheKey], resolved)
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
      isMounted = false
      entry.refHolders.delete(wsRef)
      wsRef.current = null
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
  }, [subscriptionCacheKey])

  const refresh = useCallback(() => {
    if (subscriptionCacheKey) {
      queryClient.removeQueries({ queryKey: [subscriptionCacheKey] })
    }
    setDate(Date.now())
  }, [queryClient, subscriptionCacheKey, setDate])

  return { response, refresh, subscriptionCacheKey: responseCacheKey, wsRef }
}
