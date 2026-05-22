import { listen, EventCallback } from '@tauri-apps/api/event'
import { useCallback } from 'react'

export const useListen = () => {
  const addListener = useCallback(
    async <T>(eventName: string, handler: EventCallback<T>) => {
      return await listen(eventName, handler)
    },
    [],
  )

  return {
    addListener,
  }
}
