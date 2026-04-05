import { useEffect, useRef } from 'react'

import { hideInitialOverlay } from '../utils'

export const useAppInitialization = () => {
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    let isCancelled = false
    const timers = new Set<number>()

    const scheduleTimeout = (handler: () => void, delay: number) => {
      if (isCancelled) return -1
      const id = window.setTimeout(() => {
        if (!isCancelled) {
          handler()
        }
        timers.delete(id)
      }, delay)
      timers.add(id)
      return id
    }

    const removeLoadingOverlay = () => {
      hideInitialOverlay({ schedule: scheduleTimeout })
    }

    const performInitialization = () => {
      if (isCancelled) return
      removeLoadingOverlay()
    }

    scheduleTimeout(performInitialization, 100)
    scheduleTimeout(performInitialization, 5000)

    return () => {
      isCancelled = true
      timers.forEach((id) => {
        try {
          window.clearTimeout(id)
        } catch (error) {
          console.warn('[Initialization] Failed to clear timer:', error)
        }
      })
      timers.clear()
    }
  }, [])
}
