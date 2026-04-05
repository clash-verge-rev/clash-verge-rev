import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useRef } from 'react'
import { type Message, type MihomoWebSocket } from 'tauri-plugin-mihomo-api'

export const RECONNECT_DELAY_MS = 1000

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

  const queryClient = useQueryClient()

  const wsRef = useRef<MihomoWebSocket | null>(null)
  const wsFirstConnectionRef = useRef<boolean>(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    queryKey: subscriptionCacheKey
      ? [subscriptionCacheKey]
      : ['$sub$__disabled__'],
    queryFn: () =>
      queryClient.getQueryData<T>([subscriptionCacheKey!]) ?? fallbackData,
    initialData: () =>
      queryClient.getQueryData<T>([
        subscriptionCacheKey ?? '$sub$__disabled__',
      ]) ?? fallbackData,
    staleTime: Infinity,
    gcTime: 30_000,
    enabled: subscriptionCacheKey !== null,
  })

  useEffect(() => {
    if (!subscriptionCacheKey) return

    let isMounted = true

    const clearReconnectTimer = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    const closeSocket = async () => {
      if (wsRef.current) {
        await wsRef.current.close()
        wsRef.current = null
      }
    }

    const scheduleReconnect = async () => {
      if (!isMounted) return
      clearReconnectTimer()
      await closeSocket()
      if (!isMounted) return
      timeoutRef.current = setTimeout(connectWs, RECONNECT_DELAY_MS)
    }

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
      scheduleReconnect,
      isMounted: () => isMounted,
    })

    const cleanupAll = () => {
      clearReconnectTimer()
      throttleCleanup?.()
      cleanup?.()
      void closeSocket()
    }

    const handleMessage = (msg: Message) => {
      if (msg.type !== 'Text') return
      handleTextMessage(msg.data)
    }

    async function connectWs() {
      try {
        const ws_ = await connect()
        if (!isMounted) {
          await ws_.close()
          return
        }

        wsRef.current = ws_
        clearReconnectTimer()

        if (onConnected) {
          await onConnected(ws_)
          if (!isMounted) {
            await ws_.close()
            return
          }
        }

        ws_.addListener(handleMessage)
      } catch (ignoreError) {
        if (!wsRef.current && isMounted) {
          timeoutRef.current = setTimeout(connectWs, RECONNECT_DELAY_MS)
        }
      }
    }

    if (wsFirstConnectionRef.current || !wsRef.current) {
      wsFirstConnectionRef.current = false
      cleanupAll()
      void connectWs()
    }

    return () => {
      isMounted = false
      wsFirstConnectionRef.current = true
      cleanupAll()
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

  return { response, refresh, subscriptionCacheKey, wsRef }
}
