import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

export interface IMemoryUsageItem {
  inuse: number
  oslimit?: number
}

const FALLBACK_MEMORY_USAGE: IMemoryUsageItem = { inuse: 0 }
const DUPLICATE_MEMORY_WINDOW_MS = 50

let lastMemorySignature = ''
let lastMemoryTimestamp = 0

const shouldSkipDuplicateMemory = (memory: IMemoryUsageItem) => {
  const now = Date.now()
  const signature = `${memory.inuse}:${memory.oslimit ?? ''}`

  if (
    signature === lastMemorySignature &&
    now - lastMemoryTimestamp <= DUPLICATE_MEMORY_WINDOW_MS
  ) {
    return true
  }

  lastMemorySignature = signature
  lastMemoryTimestamp = now
  return false
}

export const useMemoryData = () => {
  const { response, refresh } = useMihomoWsSubscription<IMemoryUsageItem>({
    storageKey: 'mihomo_memory_date',
    buildSubscriptKey: (date) => `getClashMemory-${date}`,
    fallbackData: FALLBACK_MEMORY_USAGE,
    connect: () => MihomoWebSocket.connect_memory(),
    throttleMs: 500,
    setupHandlers: ({ next, scheduleReconnect }) => ({
      handleMessage: (data) => {
        if (data.startsWith('Websocket error')) {
          next(data, FALLBACK_MEMORY_USAGE)
          void scheduleReconnect()
          return
        }

        try {
          const parsed = JSON.parse(data) as IMemoryUsageItem
          if (shouldSkipDuplicateMemory(parsed)) {
            return
          }
          next(null, parsed)
        } catch (error) {
          next(error, FALLBACK_MEMORY_USAGE)
        }
      },
    }),
  })

  return { response, refreshGetClashMemory: refresh }
}
