import dayjs from 'dayjs'
import { memo, useSyncExternalStore } from 'react'

type RelativeTimeListener = () => void

let currentTime = Date.now()
let timerId: number | null = null
const listeners: RelativeTimeListener[] = []

const startTimer = () => {
  if (timerId !== null) return

  timerId = window.setInterval(() => {
    currentTime = Date.now()
    for (let i = 0; i < listeners.length; i++) {
      listeners[i]()
    }
  }, 5_000)
}

const stopTimer = () => {
  if (listeners.length > 0 || timerId === null) return

  window.clearInterval(timerId)
  timerId = null
}

const subscribeRelativeTime = (listener: RelativeTimeListener) => {
  listeners.push(listener)
  startTimer()

  return () => {
    const index = listeners.indexOf(listener)
    if (index !== -1) listeners.splice(index, 1)
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
