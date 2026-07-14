import { TauriEvent } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

export const useVisibility = () => {
  const [visible, setVisible] = useState(isDocumentVisible)

  useEffect(() => {
    let mounted = true
    let visibilityTimer: ReturnType<typeof setTimeout> | null = null
    const appWindow = getCurrentWindow()

    const updateVisible = async () => {
      const windowVisible = await appWindow.isVisible().catch(() => true)
      if (mounted) {
        setVisible(isDocumentVisible() && windowVisible)
      }
    }

    const updateVisibleSoon = () => {
      if (visibilityTimer) {
        window.clearTimeout(visibilityTimer)
      }
      visibilityTimer = window.setTimeout(() => {
        visibilityTimer = null
        void updateVisible()
      }, 50)
    }

    const handleVisibleEvent = () => {
      void updateVisible()
    }

    const handlePointerDown = () => setVisible(true)

    document.addEventListener('focus', handleVisibleEvent)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('visibilitychange', handleVisibleEvent)
    window.addEventListener('focus', handleVisibleEvent)

    const unlistenFocusChanged = appWindow.onFocusChanged(updateVisibleSoon)
    const unlistenCloseRequested = appWindow.listen(
      TauriEvent.WINDOW_CLOSE_REQUESTED,
      () => {
        setVisible(false)
        updateVisibleSoon()
      },
    )
    void updateVisible()

    return () => {
      mounted = false
      if (visibilityTimer) {
        window.clearTimeout(visibilityTimer)
        visibilityTimer = null
      }
      document.removeEventListener('focus', handleVisibleEvent)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('visibilitychange', handleVisibleEvent)
      window.removeEventListener('focus', handleVisibleEvent)
      void unlistenFocusChanged.then((unlisten) => unlisten())
      void unlistenCloseRequested.then((unlisten) => unlisten())
    }
  }, [])

  return visible
}
