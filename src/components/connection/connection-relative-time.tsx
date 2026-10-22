import dayjs from 'dayjs'
import { memo, useSyncExternalStore } from 'react'

type RelativeTimeListener = () => void

let currentTime = Date.now()
let timerId: number | null = null
const listeners = new Set<RelativeTimeListener>()

const startTimer = () => {
  if (timerId !== null) return

  currentTime = Date.now()
  timerId = window.setInterval(() => {
    currentTime = Date.now()
    listeners.forEach((listener) => listener())
  }, 5_000)
}

const stopTimer = () => {
  if (listeners.size > 0 || timerId === null) return

  window.clearInterval(timerId)
  timerId = null
}

const subscribeRelativeTime = (listener: RelativeTimeListener) => {
  listeners.add(listener)
  startTimer()

  return () => {
    listeners.delete(listener)
    stopTimer()
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
