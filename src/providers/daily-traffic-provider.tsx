import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { useMihomoWsSubscription } from '@/hooks/use-mihomo-ws-subscription'
import { loadDailyTraffic, saveDailyTraffic } from '@/services/cmds'

import {
  DailyHostDisplay,
  DailyHostRecord,
  DailyTrafficContext,
} from './daily-traffic-context'

interface DailyTrafficData {
  date: string
  hosts: Record<string, DailyHostRecord>
  totalDownload: number
  totalUpload: number
}

interface PrevEntry {
  download: number
  upload: number
}

const SAVE_INTERVAL_MS = 5_000
const GC_INTERVAL = 50
const LS_KEY = 'daily_traffic_backup'

const getTodayDate = () => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const getHost = (conn: IConnectionsItem): string => {
  return conn.metadata.host || conn.metadata.destinationIP || 'unknown'
}

const initWsData = { _dummy: true as const }

export const DailyTrafficProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [records, setRecords] = useState<DailyHostDisplay[]>([])
  const [totalDownload, setTotalDownload] = useState(0)
  const [totalUpload, setTotalUpload] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const dataRef = useRef<DailyTrafficData>({
    date: getTodayDate(),
    hosts: {},
    totalDownload: 0,
    totalUpload: 0,
  })
  const prevMapRef = useRef<Map<string, PrevEntry>>(new Map())
  const snapshotCountRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const flushToState = useCallback(() => {
    const d = dataRef.current
    const hostList = Object.entries(d.hosts)
      .map(([host, rec]) => ({ host, ...rec }))
      .sort((a, b) => b.download - a.download)
    setRecords(hostList)
    setTotalDownload(d.totalDownload)
    setTotalUpload(d.totalUpload)
  }, [])

  const processSnapshot = useCallback((connections: IConnectionsItem[]) => {
    const data = dataRef.current
    const prevMap = prevMapRef.current
    snapshotCountRef.current++

    const currentIds = new Set<string>()

    for (const conn of connections) {
      currentIds.add(conn.id)
      const prev = prevMap.get(conn.id)
      if (prev) {
        const deltaDown = Math.max(0, conn.download - prev.download)
        const deltaUp = Math.max(0, conn.upload - prev.upload)

        if (deltaDown > 0 || deltaUp > 0) {
          const host = getHost(conn)
          let rec = data.hosts[host]
          if (!rec) {
            rec = { download: 0, upload: 0, lastActive: 0, connectionCount: 0 }
            data.hosts[host] = rec
          }
          rec.download += deltaDown
          rec.upload += deltaUp
          rec.connectionCount++
          rec.lastActive = Date.now()
          data.totalDownload += deltaDown
          data.totalUpload += deltaUp
        }
      }
      prevMap.set(conn.id, { download: conn.download, upload: conn.upload })
    }

    // GC: cleanup closed connections from prevMap every 50 snapshots
    if (snapshotCountRef.current % GC_INTERVAL === 0) {
      for (const id of prevMap.keys()) {
        if (!currentIds.has(id)) {
          prevMap.delete(id)
        }
      }
    }
  }, [])

  const initOrCheckDate = useCallback(async () => {
    const today = getTodayDate()
    const data = dataRef.current
    let needsFlush = false

    if (data.date !== today) {
      try {
        await saveDailyTraffic(JSON.stringify(data))
      } catch {
        /* ignore save error */
      }
      data.date = today
      data.hosts = {}
      data.totalDownload = 0
      data.totalUpload = 0
      needsFlush = true
    }

    if (Object.keys(data.hosts).length === 0) {
      try {
        const saved = await loadDailyTraffic()
        if (saved) {
          const parsed = JSON.parse(saved) as DailyTrafficData
          if (parsed.date === today && parsed.hosts) {
            data.date = parsed.date
            data.hosts = parsed.hosts
            data.totalDownload = parsed.totalDownload || 0
            data.totalUpload = parsed.totalUpload || 0
          }
        }
      } catch {
        // File load failed, try localStorage fallback
      }

      // Fallback: try localStorage if file was empty/missing
      if (Object.keys(data.hosts).length === 0) {
        try {
          const ls = localStorage.getItem(LS_KEY)
          if (ls) {
            const parsed = JSON.parse(ls) as DailyTrafficData
            if (parsed.date === today && parsed.hosts) {
              data.date = parsed.date
              data.hosts = parsed.hosts
              data.totalDownload = parsed.totalDownload || 0
              data.totalUpload = parsed.totalUpload || 0
            }
          }
        } catch {
          // localStorage fallback failed, use empty data
        }
      }
    }

    if (needsFlush || Object.keys(data.hosts).length > 0) {
      flushToState()
    }
  }, [flushToState])

  const storeToLocalStorage = (data: DailyTrafficData) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data))
    } catch {
      /* quota exceeded, ignore */
    }
  }

  const persist = useCallback(async () => {
    try {
      await saveDailyTraffic(JSON.stringify(dataRef.current))
    } catch (e) {
      console.error('[daily-traffic] save to file failed:', e)
    }
    // Dual-write to localStorage as fallback (beforeunload is unreliable in Tauri WebView)
    storeToLocalStorage(dataRef.current)
  }, [])

  // Use useMihomoWsSubscription for WS lifecycle management (auto-reconnect + mount protection)
  const { refresh: refreshSubscription } = useMihomoWsSubscription({
    storageKey: 'daily_traffic_ws',
    buildSubscriptKey: (date) => `dailyTraffic-${date}`,
    fallbackData: initWsData,
    connect: () => MihomoWebSocket.connect_connections(),
    setupHandlers: () => ({
      handleMessage: (data) => {
        if (data.startsWith('Websocket error')) return
        try {
          const parsed = JSON.parse(data) as IConnections
          if (parsed.connections) {
            processSnapshot(parsed.connections)
          }
        } catch {
          /* skip malformed message */
        }
      },
    }),
  })

  useEffect(() => {
    const start = async () => {
      await initOrCheckDate()
      setIsLoading(false)
    }

    start()

    // Synchronous backup on close
    const handleBeforeUnload = () => {
      storeToLocalStorage(dataRef.current)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    saveTimerRef.current = setInterval(() => {
      // Cross-day auto detection
      const today = getTodayDate()
      if (dataRef.current.date !== today) {
        persist().then(() => {
          dataRef.current.date = today
          dataRef.current.hosts = {}
          dataRef.current.totalDownload = 0
          dataRef.current.totalUpload = 0
        })
      } else {
        persist()
      }
      flushToState()
    }, SAVE_INTERVAL_MS)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current)
      }
      // Best-effort async save; beforeunload's localStorage is the reliable one
      persist()
    }
  }, [initOrCheckDate, flushToState, persist])

  const refresh = useCallback(async () => {
    await initOrCheckDate()
    flushToState()
    refreshSubscription()
  }, [initOrCheckDate, flushToState, refreshSubscription])

  const clear = useCallback(() => {
    dataRef.current.hosts = {}
    dataRef.current.totalDownload = 0
    dataRef.current.totalUpload = 0
    prevMapRef.current.clear()
    snapshotCountRef.current = 0
    flushToState()
    persist()
  }, [flushToState, persist])

  const value = useMemo(
    () => ({ records, totalDownload, totalUpload, isLoading, refresh, clear }),
    [records, totalDownload, totalUpload, isLoading, refresh, clear],
  )

  return <DailyTrafficContext value={value}>{children}</DailyTrafficContext>
}
