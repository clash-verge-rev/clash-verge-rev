import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useRef } from 'react'
import { mutate, type MutatorCallback } from 'swr'
import useSWRSubscription from 'swr/subscription'
import { type Message, type MihomoWebSocket } from 'tauri-plugin-mihomo-api'

export const RECONNECT_DELAY_MS = 1000

type NextFn<T> = (error?: any, data?: T | MutatorCallback<T>) => void

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
  keepPreviousData?: boolean
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
    keepPreviousData = true,
    throttleMs,
    setupHandlers,
  } = options

  // eslint-disable-next-line @eslint-react/purity
  const [date, setDate] = useLocalStorage(storageKey, Date.now())
  const subscriptKey = buildSubscriptKey(date)
  const subscriptionCacheKey = subscriptKey ? `$sub$${subscriptKey}` : null

  const wsRef = useRef<MihomoWebSocket | null>(null)
  const wsFirstConnectionRef = useRef<boolean>(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const response = useSWRSubscription<T, any, string | null>(
    subscriptKey,
    (_key, { next }) => {
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
      let wrappedNext: NextFn<T> = next

      if (throttleMs && throttleMs > 0) {
        let pendingData: T | MutatorCallback<T> | undefined
        let hasPending = false
        let timerId: ReturnType<typeof setTimeout> | null = null

        const flush = () => {
          timerId = null
          if (hasPending) {
            const data = pendingData
            pendingData = undefined
            hasPending = false
            next(undefined, data)
          }
        }

        wrappedNext = (error?: any, data?: T | MutatorCallback<T>) => {
          if (error !== undefined && error !== null) {
            next(error, data)
            return
          }
          if (!timerId) {
            next(undefined, data)
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
    },
    {
      fallbackData,
      keepPreviousData,
    },
  )

  useEffect(() => {
    if (subscriptionCacheKey) {
      mutate(subscriptionCacheKey)
    }
  }, [subscriptionCacheKey])

  const refresh = useCallback(() => {
    setDate(Date.now())
  }, [setDate])

  return { response, refresh, subscriptionCacheKey, wsRef }
}
