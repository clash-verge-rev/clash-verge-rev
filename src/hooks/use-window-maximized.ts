import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

import debounce from '@/utils/debounce'

export const useWindowMaximized = (enabled: boolean) => {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const currentWindow = getCurrentWindow()
    let isUnmounted = false

    const syncMaximized = async () => {
      if (isUnmounted) return
      try {
        setMaximized(await currentWindow.isMaximized())
      } catch (error) {
        console.warn('[useWindowMaximized] 读取最大化状态失败:', error)
      }
    }

    void syncMaximized()

    const unlistenPromise = currentWindow.onResized(
      debounce(syncMaximized, 300),
    )

    return () => {
      isUnmounted = true
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch((err) =>
          console.warn('[useWindowMaximized] 清理监听器失败:', err),
        )
    }
  }, [enabled])

  return { maximized, setMaximized }
}
