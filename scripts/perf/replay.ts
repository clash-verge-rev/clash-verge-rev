export interface Frame {
  sequence: number
  timestamp: number
  payload: ILogItem[] | IConnections
}
export const params = new URLSearchParams(location.search)
export const scenario = params.get('scenario') ?? 'traffic'
export const layer = params.get('layer') ?? 'component'
const listeners = new Set<(frame: Frame) => void>()
export const subscribe = (listener: (frame: Frame) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function startReplay() {
  const data = document.documentElement.dataset
  let previous = 0
  data.perfReceived = '0'
  data.perfGaps = '0'
  const socket = new WebSocket(`ws://127.0.0.1:${params.get('port')}`)
  socket.onmessage = ({ data: raw }) => {
    const frame = JSON.parse(raw) as Frame
    if (frame.sequence !== previous + 1)
      data.perfGaps = String(Number(data.perfGaps) + 1)
    previous = frame.sequence
    data.perfReceived = String(previous)
    data.perfSourceTime = String(frame.timestamp)
    for (const listener of listeners) listener(frame)
  }
  socket.onerror = () => {
    data.perfError = 'replay socket failed'
  }
  socket.onclose = () => {
    data.perfError = 'replay socket closed'
  }
}
