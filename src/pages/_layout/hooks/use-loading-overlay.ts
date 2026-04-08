import { useEffect, useRef } from 'react'

import { hideInitialOverlay } from '../utils'

export const useLoadingOverlay = (themeReady: boolean) => {
  const doneRef = useRef(false)

  useEffect(() => {
    if (!themeReady || doneRef.current) return
    doneRef.current = true

    const timer = hideInitialOverlay()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [themeReady])
}
