import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { subscribe, scenario } from './replay'

// Only this perf entry replaces socket transport; the normal application never imports it.
export function installAdapter() {
  const connect = async (kind: string) => {
    const data = document.documentElement.dataset
    data.perfSubscriptions = String(Number(data.perfSubscriptions || 0) + 1)
    const callbacks = new Set<
      (message: { type: 'Text'; data: string }) => void
    >()
    const unsubscribe = subscribe((frame) => {
      const messages =
        kind === 'logs'
          ? (frame.payload as ILogItem[])
          : [
              kind === 'traffic'
                ? { up: frame.sequence * 1000, down: frame.sequence * 5000 }
                : frame.payload,
            ]
      for (const payload of messages) {
        const message = { type: 'Text' as const, data: JSON.stringify(payload) }
        callbacks.forEach((callback) => {
          callback(message)
          data.perfDelivered = String(Number(data.perfDelivered || 0) + 1)
        })
      }
    })
    return {
      addListener: (
        callback: (message: { type: 'Text'; data: string }) => void,
      ) => {
        callbacks.add(callback)
        return () => callbacks.delete(callback)
      },
      close: async () => {
        unsubscribe()
        callbacks.clear()
        data.perfSubscriptions = String(Number(data.perfSubscriptions) - 1)
      },
    } as unknown as MihomoWebSocket
  }
  MihomoWebSocket.connect_logs = async () => connect('logs')
  MihomoWebSocket.connect_connections = async () => connect('connections')
  MihomoWebSocket.connect_traffic = async () => connect('traffic')
  if (scenario === 'logs')
    localStorage.setItem(
      'clash-log',
      JSON.stringify({
        enable: true,
        logLevel: 'INFO',
        logFilter: 'all',
        logOrder: 'desc',
      }),
    )
}
