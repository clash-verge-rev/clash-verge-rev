import dayjs from 'dayjs'
import { memo, useSyncExternalStore } from 'react'

type RelativeTimeListener = () => void

let currentTime = Date.now()
let timerId: number | null = null
const listeners = new Set<RelativeTimeListener>()

const startTimer = () => {
  if (timerId !== null || document.hidden || listeners.size === 0) return

  currentTime = Date.now()
  timerId = window.setInterval(() => {
    currentTime = Date.now()
    listeners.forEach((listener) => listener())
  }, 5_000)
}

const stopTimer = () => {
  if (timerId === null) return

  window.clearInterval(timerId)
  timerId = null
}

const handleVisibilityChange = () => {
  if (document.hidden) {
    stopTimer()
  } else {
    startTimer()
    listeners.forEach((listener) => listener())
  }
}

const subscribeRelativeTime = (listener: RelativeTimeListener) => {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }
  startTimer()

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }
}

const getRelativeTimeSnapshot = () => currentTime

interface RelativeTimeProps {
  start: string
}

export const RelativeTime = memo(function RelativeTime({
  start,
}: RelativeTimeProps) {
  const now = useSyncExternalStore(
    subscribeRelativeTime,
    getRelativeTimeSnapshot,
    getRelativeTimeSnapshot,
  )
  return <>{dayjs(start).from(now)}</>
})
