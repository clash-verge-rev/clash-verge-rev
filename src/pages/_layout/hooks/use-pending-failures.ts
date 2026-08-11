import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef } from 'react'

import { getPendingFailures } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { showNotice } from '@/services/notice-service'

/** Return whether a native window is visible and not minimized; fail closed. */
const windowIsWatched = async () => {
  const window = getCurrentWindow()
  try {
    const [visible, minimized] = await Promise.all([
      window.isVisible(),
      window.isMinimized(),
    ])
    return visible && !minimized
  } catch (error) {
    console.warn('[pending-failures] window state unavailable:', error)
    return false
  }
}

/** Show each pending failure sequence once when the window can be read. */
export const usePendingFailures = () => {
  const shownSequencesRef = useRef(new Map<string, number>())

  const showNewFailures = useCallback(async () => {
    let failures
    try {
      failures = await getPendingFailures()
    } catch (error) {
      console.warn('[pending-failures] could not be read:', error)
      return
    }
    if (failures.length === 0) return

    if (!(await windowIsWatched())) return

    for (const failure of failures) {
      const shown = shownSequencesRef.current.get(failure.code)
      if (shown !== undefined && shown >= failure.sequence) continue
      shownSequencesRef.current.set(failure.code, failure.sequence)
      showNotice.error({ code: failure.code, detail: failure.detail })
    }
  }, [])

  useEffect(() => {
    const read = () => {
      void showNewFailures()
    }

    const unsubscribe = subscribeVergeEvents(
      { 'verge://pending-failures-changed': read },
      read,
    )

    const readWhenVisible = () => {
      if (document.visibilityState === 'visible') read()
    }
    document.addEventListener('visibilitychange', readWhenVisible)

    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) read()
    })

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', readWhenVisible)
      void unlistenFocus.then((unlisten) => unlisten())
    }
  }, [showNewFailures])
}
