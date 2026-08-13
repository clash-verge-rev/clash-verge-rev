import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getPendingFailures, type PendingFailure } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { showNotice } from '@/services/notice-service'

/** Failures handled by the recovery dialog instead of a toast. */
const CODES_SHOWN_AS_A_DIALOG = new Set<string>([
  'SYSPROXY_PRIVILEGE_REQUIRED',
  'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
])

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

const usePendingFailureReader = (
  onFailures: (failures: PendingFailure[]) => void,
) => {
  // Avoid resubscribing when the handler changes.
  const handlerRef = useRef(onFailures)
  handlerRef.current = onFailures

  useEffect(() => {
    const read = () => {
      void (async () => {
        let failures: PendingFailure[]
        try {
          failures = await getPendingFailures()
        } catch (error) {
          console.warn('[pending-failures] could not be read:', error)
          return
        }
        handlerRef.current(failures)
      })()
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
  }, [])
}

/** Show each pending failure sequence once when the window can be read. */
export const usePendingFailures = () => {
  const shownSequencesRef = useRef(new Map<string, number>())

  const showNewFailures = useCallback(async (failures: PendingFailure[]) => {
    const asToast = failures.filter(
      (failure) => !CODES_SHOWN_AS_A_DIALOG.has(failure.code),
    )
    if (asToast.length === 0) return

    if (!(await windowIsWatched())) return

    for (const failure of asToast) {
      const shown = shownSequencesRef.current.get(failure.code)
      if (shown !== undefined && shown >= failure.sequence) continue
      shownSequencesRef.current.set(failure.code, failure.sequence)
      showNotice.error({ code: failure.code, detail: failure.detail })
    }
  }, [])

  usePendingFailureReader(
    useCallback(
      (failures) => {
        void showNewFailures(failures)
      },
      [showNewFailures],
    ),
  )
}

/** Return the oldest undismissed failure owned by the dialog. */
export const useDialogFailure = () => {
  const [failure, setFailure] = useState<PendingFailure | null>(null)
  // Dismiss locally without retiring the backend failure.
  const [dismissedSequence, setDismissedSequence] = useState<number | null>(
    null,
  )

  usePendingFailureReader(
    useCallback((failures) => {
      setFailure(
        failures.find((entry) => CODES_SHOWN_AS_A_DIALOG.has(entry.code)) ??
          null,
      )
    }, []),
  )

  const dismiss = useCallback(() => {
    setDismissedSequence(failure?.sequence ?? null)
  }, [failure])

  const shown =
    failure && failure.sequence !== dismissedSequence ? failure : null

  return { failure: shown, dismiss }
}
